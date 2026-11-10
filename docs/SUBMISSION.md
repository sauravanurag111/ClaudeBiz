# Submission checklist

| Form field | What to submit |
|---|---|
| **Two-page strategy document** (PDF) | `docs/Dealflow_Strategy.pdf` |
| **Product execution prototype** (link) | https://dealflow-2vnc.onrender.com + "Test login: demo@dealflow.app / demo1234. MCP connector: `https://dealflow-2vnc.onrender.com/mcp/demo-volopay-7Qx2pLk9`. Simulated: payment collection (client clicks 'I've paid'; no gateway); email is real only when Brevo is configured; demo payment details are samples." |
| **Architecture & implementation notes** (file) | `docs/Dealflow_Architecture.pdf` (diagram, data flow, our-app vs partner responsibilities, tools, assumptions, limitations, built vs proposed, next steps). Full README: https://github.com/sauravanurag111/ClaudeBiz |
| **Video walkthrough** (link) | Your Loom/YouTube (unlisted) link. Script: `docs/VIDEO_SCRIPT.md` |
| **Supporting files** (optional) | `docs/Dealflow_Economics.xlsx` (unit economics + 1y/3y projection, all formulas) |
| **Anything we should know?** | "Connect Claude: Settings → Connectors → Add custom connector → paste the MCP URL (no OAuth). The test account's connector URL is shared, so reviewers may see each other's test quotes; signing up gives a private one. The app is on a free host; the first load after idle can take ~30–50 s." |

Rebuild the PDFs with the real URL: `node docs/build.cjs https://<your-app>.onrender.com`
