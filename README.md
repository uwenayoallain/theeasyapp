# theeasyapp — Fast CSV Spreadsheet Viewer

To install dependencies:

```bash
bun install
```

To start a development server (HMR):

```bash
bun dev
```

To run for production:

```bash
bun start
```

Features

- Streaming CSV loader in a Web Worker with progressive rendering
- Open CSV from file picker or URL; accepts `?url=...`
- Virtualized grid for 100k+ rows with smooth scroll
- Keyboard navigation (arrows, Home/End, PageUp/Down, Enter, Tab; Ctrl/Cmd+C copy)
- Column resizing with persistence
- Sorting (click header to cycle none → asc → desc)
- Per-column filtering row with debounced includes matching
- Selection metrics (sum/avg/min/max) in status bar

Usage

1. Start dev server: `bun dev`
2. Load sample: click "Sample" or open `/?url=/data/sample.csv`
3. Open your own CSV via "Open CSV" or paste a URL and click "Load"

Testing

```bash
bun test
```

Notes

- Bun-first stack: `Bun.serve`, HTML imports, no Vite/Express
- No runtime CSV deps; native parser + streaming state machine
