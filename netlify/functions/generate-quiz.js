import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const MODEL = "gemini-3.8-flash";
const DATA_DIR = path.join(process.cwd(), "DATA");
const PROMPT_FILE = path.join(process.cwd(), "PROMPT", "Quizz7.txt");

// The prompt asks for "between MIN and MAX" questions. MAX is capped so the
// model answers before the Netlify function timeout (~10 s).
const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 5;

class BadRequestError extends Error {}
class UpstreamError extends Error {}

// Finds the chapter file by whitelisting each level against what really exists
// in DATA/. The client's values are only ever compared to directory entries,
// never joined into a path, so "../" tricks cannot reach files outside DATA/.
async function resolveChapter(category, course, chapter) {
  const categories = await readdir(DATA_DIR, { withFileTypes: true });
  const categoryDir = categories.find(
    (entry) => entry.isDirectory() && entry.name === category
  );
  if (!categoryDir) throw new BadRequestError("Unknown category");
  const categoryPath = path.join(DATA_DIR, categoryDir.name);

  // Course folders are named "<code> - <name>", e.g. "BUS13-2 - Designing Operations from Scratch".
  const courses = await readdir(categoryPath, { withFileTypes: true });
  const courseDir = courses.find(
    (entry) => entry.isDirectory() && entry.name.startsWith(`${course} - `)
  );
  if (!courseDir) throw new BadRequestError("Unknown course");
  const coursePath = path.join(categoryPath, courseDir.name);

  const chapters = await readdir(coursePath, { withFileTypes: true });
  const chapterFile = chapters.find(
    (entry) => entry.isFile() && entry.name === `${chapter}.md`
  );
  if (!chapterFile) throw new BadRequestError("Unknown chapter");

  return {
    courseName: courseDir.name.slice(`${course} - `.length),
    chapterPath: path.join(coursePath, chapterFile.name),
  };
}

// Replaces every {{KEY}} in a single pass, so placeholders that happen to
// appear inside the course notes are left untouched. A replacer function is
// used because a plain string would give "$&" or "$1" in the notes a special
// meaning.
function fillTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    key in values ? String(values[key]) : match
  );
}

function questionRange(numQuestions) {
  const requested = Number.isInteger(numQuestions) ? numQuestions : MAX_QUESTIONS;
  const max = Math.min(Math.max(requested, MIN_QUESTIONS), MAX_QUESTIONS);
  return { min: MIN_QUESTIONS, max };
}

// The key is read on the server only: the browser never sees it.
async function askGemini(prompt) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        // Less "thinking" before answering keeps us under the function timeout.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    return response.text;
  } catch (err) {
    // Keep the details (quota, network, bad key) in the logs, not in the response.
    console.error("Gemini call failed:", err);
    throw new UpstreamError("The quiz generator is unavailable, try again later");
  }
}

// Only checks that the answer is a quiz at all. Validating each question
// (4 options, answer_index in range...) is a separate task.
function parseQuiz(rawText) {
  let quiz;
  try {
    quiz = JSON.parse(rawText);
  } catch {
    console.error("Model returned invalid JSON:", rawText);
    throw new UpstreamError("The quiz generator returned an invalid answer, try again");
  }
  if (!Array.isArray(quiz?.questions) || quiz.questions.length === 0) {
    console.error("Model returned JSON without questions:", rawText);
    throw new UpstreamError("The quiz generator returned an invalid answer, try again");
  }
  return quiz;
}

export default async (req) => {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set");
    return Response.json({ error: "Server is not configured" }, { status: 500 });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed, use POST" }, { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const { category, course, chapter, numQuestions } = body ?? {};
  if (![category, course, chapter].every((value) => typeof value === "string" && value)) {
    return Response.json(
      { error: "category, course and chapter are required strings" },
      { status: 400 }
    );
  }

  try {
    const { courseName, chapterPath } = await resolveChapter(category, course, chapter);
    const { min, max } = questionRange(numQuestions);

    const [template, notes] = await Promise.all([
      readFile(PROMPT_FILE, "utf8"),
      readFile(chapterPath, "utf8"),
    ]);

    const prompt = fillTemplate(template, {
      COURSE_NAME: courseName,
      COURSE_NOTES: notes,
      MIN_QUESTIONS: min,
      MAX_QUESTIONS: max,
    });

    const quiz = parseQuiz(await askGemini(prompt));

    // The course name comes from DATA/, not from the model, so it is always right.
    return Response.json({ course: courseName, questions: quiz.questions });
  } catch (err) {
    if (err instanceof BadRequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof UpstreamError) {
      return Response.json({ error: err.message }, { status: 502 });
    }
    console.error("generate-quiz failed:", err);
    return Response.json({ error: "Internal error while preparing the quiz" }, { status: 500 });
  }
};
