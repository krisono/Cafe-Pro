### Candidate Name:
Nnaemeka Onochie

### Scenario Chosen:
Green-Tech Inventory Assistant - Small Cafe

### Estimated Time Spent:
5 hours and 30 mins

### Quick Start:

Prerequisites:

- Node.js v18 or higher
- npm
- OpenAI API key

Run Commands:

- npm install
- .env → open .env and set OPENAI_API_KEY=sk-your-key-here
- npm run dev

Test Commands:

- npm test → runs all 23 tests using in-memory SQLite (no setup needed)

### AI Disclosure:

- Did you use an AI assistant (Copilot, ChatGPT, etc.)? (Yes/No)
  - Yes

- How did you verify the suggestions?
  - I verified the suggestions by only accepting the lines of code that I needed from it and rejecting most of the ones I didn't need. I also verified by repeatedly running the application and seeing the results.

- Give one example of a suggestion you rejected or changed:
  - An example was when it generated a whole complex logic for determining which of the bathes of food was expired but instead i made it simple by just tying the batches of delivery to a single expiry date.

### Tradeoffs & Prioritization:

- What did you cut to stay within the 4–6 hour limit?
  - I made sure not to focus on the little details and extra features like having a complete backlog for the past deliveries so we can see possible discrepancies. i also made the dashboard very simpel and easy to understand

- What would you build next if you had more time?
  - I would make the logic stronger. I would also use a real dataset from a storeand make the AI beig used for just generating suggestions. I woudld also strengthen the ffallback logic and the tests. I could also add an image scan for deliveries that can scan it and put in some of the information automatically making the receiving process faster. 

- Known limitations:
  - Uses very basic data and doesnt use a lot of realistic standards. The UI is also not finely tuned and specific. THe AI suggestions is also fluid and could be wrong which is why the fallback logic is important. I also didnt have enough time to really furnish the front end UI and fix minor bugs. 

### Video link:
