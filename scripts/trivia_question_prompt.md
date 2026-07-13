You're writing multiple-choice trivia questions for a movie trivia game called filmprint. I'm giving you a CSV of ~250 well-known movies (title, year, runtime, genres, keywords, director, top cast with character names, tagline, overview, critic scores, box office revenue).

For each movie, write exactly 3 questions: one easy, one medium, one hard. Ground every question in facts from the CSV row or in genuinely well-known, verifiable knowledge about that specific film — do not invent plot details, quotes, box office figures, release dates, cast members, or awards that aren't in the data or that you aren't confident are correct. If a movie doesn't have enough distinctive material for 3 good questions, write fewer rather than padding with something generic or shaky.

Difficulty guide:
- Easy: identifiable from the movie's most famous/obvious element (a lead actor, the director if famous, the general plot premise).
- Medium: requires having actually seen or closely followed the movie (a specific plot turn, a supporting character, a production detail).
- Hard: a specific, genuinely obscure-but-true detail (a minor character's name, a specific line, a specific number/stat).

Avoid:
- Yes/no or true/false framing — every question needs 4 distinct multiple-choice options.
- Questions where two options could both be defended as correct.
- Reusing the same question angle for every movie (don't make every "hard" question a release-year trivia fact, vary the angle: plot, character, quote, production, trivia).

Output format: one JSON object per line (JSONL), no surrounding array, no markdown code fences, no commentary before/after. Each object:

{"movie_id": <int, copied exactly from the CSV row>, "difficulty": "easy"|"medium"|"hard", "question_text": "<the question>", "correct_answer": "<the correct option, exact string>", "options": ["<4 strings total, including the correct answer, order doesn't matter>"]}

Example:

{"movie_id": 157336, "difficulty": "easy", "question_text": "Who directed Interstellar?", "correct_answer": "Christopher Nolan", "options": ["Christopher Nolan", "Denis Villeneuve", "Ridley Scott", "James Cameron"]}

Work through the CSV in order. If you run out of room in one response, stop at a clean movie boundary (don't cut a movie off mid-way through its 3 questions) and I'll ask you to continue from where you left off.
