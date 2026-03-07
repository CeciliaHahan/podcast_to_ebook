# Chrome Extension (MVP Side Panel)

This extension now runs the transcript workflow entirely inside the side panel:

- configure LLM base URL + model + API key
- generate one-pass working notes from a transcript
- generate a booklet outline from working notes
- generate a booklet draft from the outline
- export EPUB directly in the browser
- restore the last workspace from `chrome.storage.local`
- view stage-by-stage inspector trace

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `extension/`

## Usage

1. Click extension icon
2. Click **Open Side Panel**
3. In Side Panel, set:
   - LLM Base URL (default: `https://openrouter.ai/api/v1`)
   - Model (default: `google/gemini-3-flash-preview`)
   - API key
4. Fill transcript form
5. Run the stages in order: Working Notes -> Outline -> Draft -> EPUB

## Notes

- Current UI is transcript-first and EPUB-only (PDF/Markdown can be added back later).
- Settings, transcript text, staged outputs, and inspector traces are saved in `chrome.storage.local`.
- The extension no longer needs a local backend on `http://localhost:8080`.
- The bundled manifest currently allows direct calls to OpenRouter and OpenAI official endpoints.
