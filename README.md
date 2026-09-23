# AlbertStudy
Albert Study is an AI-powered web app that transforms course materials into personalized study sessions. Students can use AI-generated quizzes, exercises, explanations, flashcards, and mock exams while the app tracks their progress and adapts to their weaknesses.

Live site: https://albert-study.netlify.app

## Project structure

| Folder | Content |
|---|---|
| `UI/` | Static front end (HTML, CSS, JS), published as is by Netlify |
| `netlify/functions/` | Serverless functions, the only place that talks to the AI |
| `PROMPT/` | Quiz prompts (`Quizz7.txt` is the one in use) |
| `DATA/` | Course notes, one Markdown file per chapter: `DATA/<category>/<CODE - Course name>/<NN-chapter>.md` |

## Run it locally

Requirements: [Node.js](https://nodejs.org) 20 or later and the Netlify CLI (`npm install -g netlify-cli`).

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Get your own **free** Gemini API key on [Google AI Studio](https://aistudio.google.com/apikey) (Google account only, no credit card).
3. Copy `.env.example` to `.env` and paste your key:

   ```
   GEMINI_API_KEY=your-key-here
   ```

   `.env` is listed in `.gitignore`. Run `git status` and make sure it does **not** appear before you commit: this repository is public, and a leaked key is picked up by bots within minutes.
4. Start the site and its functions on http://localhost:8888:

   ```bash
   netlify dev
   ```

Everyone creates their own key for local work. Nobody shares a key: the production key only lives in the Netlify environment variables.

## API

### `POST /.netlify/functions/generate-quiz`

Generates a multiple-choice quiz from one chapter.

Request:

```json
{ "category": "DAT", "course": "DAT32-91", "chapter": "08-prompting-as-a-craft", "numQuestions": 5 }
```

Response:

```json
{
  "course": "Prompt Engineering and Git",
  "questions": [
    {
      "question": "…",
      "options": ["…", "…", "…", "…"],
      "explanations": ["…", "…", "…", "…"],
      "answer_index": 1,
      "source_quote": "…",
      "difficulty": "easy"
    }
  ]
}
```

| Status | Meaning |
|---|---|
| 400 | Invalid body, or unknown category, course or chapter |
| 405 | Method other than `POST` |
| 500 | Server misconfigured (no API key) |
| 502 | The AI provider is unavailable or returned an unusable answer: try again |

## Design choices and trade-offs

- **The API key never reaches the browser.** Everything sent to the browser can be read by the user, so the AI is only called from a serverless function running on Netlify. The browser only sees the question and the answer.
- **Course files are whitelisted, never built from user input.** The function compares `category`, `course` and `chapter` to the folders and files that really exist in `DATA/`. Building the path by concatenation would let a request such as `"chapter": "../../.env"` read the server's secrets.
- **Google Gemini instead of Anthropic,** because Gemini has a free tier and the Anthropic API does not.
- **Free tier trade-off:** on the free tier, Google may use the requests to improve its models. We accept it because the only data sent is public course notes, never personal data.
- **Small and fast:** a Netlify function is stopped after about 10 seconds. The quiz is therefore capped at 5 questions and uses a fast "Flash" model with reduced reasoning.
