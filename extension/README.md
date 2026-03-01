# Chrome Extension (MVP Side Panel)

This extension provides the V1 transcript workflow:

- configure API URL + bearer token
- submit transcript job
- poll job status
- view artifacts and stage-by-stage inspector trace

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `extension/`

## Usage

1. Click extension icon
2. Click **Open Side Panel**
3. In Side Panel, set:
   - API Base URL (default: `http://localhost:8080`)
   - Bearer token (default: `dev:cecilia@example.com`)
4. Fill transcript form and submit

## Notes

- Current UI is transcript-first (other input modes will be added in next iterations).
- Settings and last job id are saved in `chrome.storage.local`.
