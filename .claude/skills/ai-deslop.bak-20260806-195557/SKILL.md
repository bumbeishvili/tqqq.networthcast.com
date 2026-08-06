---
name: ai-deslop
description: Write prose a skeptical reader can check: numbers you measured and claims you can attribute, in sentences without the padding that gives generated text away. Applies to chat replies, markdown docs, READMEs, commit bodies, PR descriptions and code comments. Branches on audience: a full style pass for human-facing prose, structure-preserving rules for files a model reads (SKILL.md, CLAUDE.md, specs, prompts). Use when writing or editing prose of any kind, when a draft reads as AI-generated, or when asked to deslop, de-AI, or clean up the writing in a file.
---

# ai-deslop

Two audiences, two rule sets. Decide which one you are writing for before applying anything below.

**Human-facing** — chat replies, READMEs, docs, commit bodies, PR descriptions, code comments. Full pass: Substance, then Style. In comments, match the density and idiom of the surrounding file, and explain why rather than restating the line.

**Model-facing** — SKILL.md, CLAUDE.md, specs, prompt files, anything loaded as context. Apply Substance in full, then the rules in [For files a model reads](#for-files-a-model-reads). Keep the structure; the Style shape rules do not apply.

## Substance

These outrank every style rule. A reader forgives an em dash. They stop trusting a document that invented a statistic.

- **Give the number you measured, or give no number.** Replace invented proportions — "half of what you learn", "most of the time", "80% of cases", "nine times out of ten" — with the count you actually have, or with the mechanism and no quantity at all.
- **Rank only what you can rank.** "The single most expensive mistake", "the highest-yield technique", "the biggest problem in X" assert an ordering nobody established. Say what the thing costs and let the reader place it.
- **Attribute it or drop it.** "Studies show", "experts agree", "industry reports suggest", "it is well known" stand in for a citation you do not have. Name the source, or state the claim as your own and carry the risk.
- **Give the mechanism instead of the emphasis.** "X is critical" tells the reader nothing they can act on. "Without X the build silently reuses the previous config" tells them why to care and lets them check you.
- **Say when you do not know.** A stated gap is usable. Hedged filler such as "may potentially help in some contexts" fills the space where the gap should be visible.
- **Cut specifics with a short shelf life.** Version numbers, model names, benchmark figures and descriptions of current behaviour date faster than the document holding them. Keep the finding, drop the perishable detail, and link the source so a reader who wants the figure can get a current one.

## Style

Each rule names what to write. The pattern it replaces follows.

### Sentences

- **State the claim on its own.** Contrastive scaffolding — "it's not just X, it's Y", "this isn't X, it's Y", "X rather than Y" for rhythm — adds a beat and no content. Contrast earns its place when the rejected option is one a reader would genuinely pick.
- **End on the point.** A short profound-sounding closer reads as a summary while adding nothing: "A bug you cannot trigger is a bug you cannot verify." Finish on the operational detail, or stop at the previous sentence.
- **Use `is`.** "Serves as", "stands as", "represents", "marks", "boasts" and "features" inflate a plain statement of fact.
- **Vary sentence length.** Uniform mid-length sentences produce an even cadence that reads as machine-paced. Put a short sentence after a long one.
- **Repeat the word.** When a paragraph is about a cache, call it the cache every time. Rotating through synonyms makes a reader check whether the subject changed.
- **List what there is.** Three items because there are three. Two is fine, five is fine; the shape of the list should come from the content. Apply the drop test below before trusting a triad.

### Words

- **Prefer the plain word.** Frequent inflations: delve, tapestry, landscape, realm, testament, vibrant, crucial, intricate, robust, showcase, boasts, nestled, "in the heart of", "in today's fast-paced world", "at its core", "the key takeaway".
- **Cut participle tails.** "…, highlighting the importance of maintainability" appended to a sentence adds significance without information. Make it a claim of its own or delete it.
- **Commit to the verb.** "Might potentially be able to help" is three hedges wrapped around "helps".

### Shape

- **Separate the sentences.** An em dash joining two independent clauses usually wants to be a full stop. One in a paragraph is punctuation; several is a fingerprint.
- **Bold what a reader scans for** — a term being defined, the key in a list. Bolding for emphasis mid-paragraph reads as mechanical.
- **Write prose as prose.** A wall of `- **Header:** text` bullets suits a reference table and fails an explanation someone reads once.
- **Sentence case in headings.** Title Case On Every Main Word is a formatting tell.
- **Use standard list markers.** Emoji bullets, and section titles like "Challenges and Future Directions", signal a template rather than a document.
- **Stop when the content stops.** Speculative wrap-ups such as "Despite its strengths, challenges remain" are filler in the shape of a conclusion.

## Calibration

Every pattern above is legitimate writing when chosen deliberately. Density and purpose separate a choice from a tic, and no single instance is a verdict — the tells stack.

Over-correcting does its own damage:

- Flat, clipped, voiceless prose is not the target. Claims a reader can check are the target.
- An em dash you want is fine. A triad that is genuinely three things is fine. Contrast that clarifies a real alternative is fine.
- Keep specifics you can support. Specificity is what slop lacks; removing detail to sound less confident throws away the part that was working.
- Restating a load-bearing rule in a file a model reads is positioning, not repetition.

## Checking your own draft

You read your own draft as the meaning you intended rather than as the words on the page, so the rules above are easier to state than to apply to yourself. Three checks that work from the author's chair:

- **Drop test for lists.** Read each item alone. An item that says nothing by itself is there for rhythm. "Measured numbers, plain claims, no rhetorical scaffolding" has two concrete items and a third filling the slot; cutting it improves the sentence.
- **Read the one-line summaries separately from the body.** Taglines, descriptions, commit subjects and table cells compress hardest, and compression invites a rhythmic pattern in place of content. They also read as labels rather than prose, so a careful review of the body passes over them.
- **Fix every copy.** One summary reused across a README, a plugin manifest and a skill description turns a single padded phrase into several files to edit.
- **Writing a file does not check it, and editing it checks only the lines you touched.** A file you authored has had no pass at all. When you ship a document alongside others, every file you wrote is part of the deliverable and needs its own pass.

Tells with a fixed shape are the findable ones. Tells defined by absence — a list item with no content, an aphorism sitting where a criterion belongs — need these checks instead.

## For files a model reads

Apply Substance in full, then:

- **Keep the structure.** Headings, bullets, bold keys, tables, code blocks. Format affects how reliably a model follows a file, so preserve it rather than trimming it to human taste.
- **Frame instructions positively.** Write "Wait on an observable condition: `until()`, `waitForSelector`" in place of "never use a fixed sleep". Models follow prohibitions unreliably, and naming a forbidden thing tends to activate it. Where the anti-pattern has to appear, state the correct action first and the pattern to avoid second.
- **State each rule once, in one authoritative place.** Overlapping rule sections leave a model no way to tell which governs, and it resolves the conflict unpredictably.
- **Keep prose and code in agreement.** A document describing behaviour the code does not have gets followed anyway, because agents trust documentation over source. Check every claim about a file against the file.
- **Replace aphorisms with criteria.** An aphorism sits in the slot where the operational rule belongs. Instead of "a bug you cannot trigger is a bug you cannot verify", state the condition under which to stop reproducing and ask for what is missing.

## On request: cleaning up an existing file

"Deslop this" means edit the file and report what you cut. "Audit this" or "what would you change" means report first and wait. Take the imperative as authority to cut.

1. Read the whole file, plus anything it cross-references.
2. Verify its factual claims against the code, config or source it describes. Fix drift before touching style, and report it separately — a document that contradicts its own artifact is the more expensive defect.
3. Walk the Substance and Style sections above with the file open, one rule at a time, reading the rules as written. A pattern list recalled from memory loses entries between passes, and the entries it loses are the ones you last found nothing for.
4. **Ask what the document is for, then cut what does not serve that.** A README exists so a reader can install the thing and judge whether they want it. Design rationale, a restatement of the artifact's own contents, and a gloss on a cited source all belong somewhere else.
5. **Cut structure as well as sentences.** A one-row table, a section explaining a file the reader can open, and a bulleted list where one line would do are padding with formatting on top. Deleting a section is a normal outcome of this pass.
6. Report the result: word count before and after, what you removed, and why each cut was safe. Lead with the most expensive defect. Name the same defect anywhere else you noticed it, without fixing files you were not asked about.

Judge the file rather than the author, and mark which findings you measured and which are your reading.
