# 100 Flashcard Generation Test Cases

## A. Happy Path — Direct Generation (1–10)

1. "Make 10 flashcards about the solar system"
2. "Create 20 flashcards about World War 2 dates"
3. "Generate flashcards for French vocabulary, 15 cards"
4. "Fiszki z tabliczki mnożenia, 30 sztuk"
5. "Make flashcards about JavaScript array methods"
6. "Create anatomy flashcards: bones of the human body"
7. "Generate 5 flashcards about the water cycle"
8. "Stwórz fiszki z czasowników nieregularnych, 20 sztuk"
9. "Make flashcards about Python data types"
10. "Generate 12 flashcards about major world rivers"

## B. Multi-Batch / Large Requests (11–18)

11. "Make 500 flashcards about US history"
12. "1000 English vocabulary flashcards"
13. "300 flashcards about chemistry elements"
14. "Create 2000 flashcards for medical terminology"
15. "Make 50 flashcards about Shakespeare plays"
16. "250 flashcards about programming languages"
17. "Fiszki z biologii, 150 sztuk"
18. "800 flashcards about world geography"

## C. Language Switching (19–26)

19. "Make flashcards about photosynthesis" (English request)
20. "Stwórz fiszki o fotosyntezie" (Polish request)
21. "Genera flashcards about photosynthesis" (mixed PL/EN)
22. "Create flashcards" then switch language mid-conversation
23. "Generuj fiszki" then switch to English
24. "Make flashcards about German grammar" (EN request, DE content)
25. "Fiszki z angielskiego: phrasal verbs" (PL request, EN content)
26. User writes in unsupported language

## D. File Upload + Processing (27–34)

27. Upload PDF → "Make flashcards from this file"
28. Upload text file → "Create 20 flashcards from this content"
29. Upload image → "Make flashcards about this diagram"
30. Upload PDF → "Summarize and make flashcards"
31. Upload large PDF → "Extract key concepts and make 50 flashcards"
32. Upload file → "just the key terms"
33. Upload malformed/corrupt file
34. Upload empty file

## E. URL Fetch + Processing (35–42)

35. "Go to wikipedia.org/wiki/Photosynthesis and make flashcards"
36. "Make flashcards from this article: [URL]"
37. URL returns 404
38. URL is a PDF link
39. URL requires authentication
40. URL is very large (book-length)
41. URL returns rate-limited
42. User provides multiple URLs

## F. Plan-Based Complex Flows (43–48)

43. "Research and create flashcards about quantum computing"
44. "Make a comprehensive study set for the Civil War"
45. "Create flashcards for my biology exam, covering cells, genetics, and evolution"
46. "I need to learn about the French Revolution, make flashcards"
47. "Create flashcards from these notes and this URL"
48. Complex plan with 6+ steps

## G. User Interruptions / Redirects (49–56)

49. Interrupt mid-generation: "actually, make it about something else"
50. Agent starts → user says "stop"
51. "Make flashcards" → user says "no, I meant explain this concept"
52. After batch 1 preview → "these are too easy, make harder ones"
53. After batch 1 → "change the format to multiple choice"
54. User asks a question mid-generation
55. User rejects batch and wants to restart
56. User provides feedback on first batch → regenerate

## H. Error Recovery (57–64)

57. Network timeout during generation
58. LLM API error
59. `generate_flashcards` returns partial response
60. Tool execution error
61. Token limit exceeded
62. Rate limit hit
63. Tool call fails mid-plan
64. Empty response from tool

## I. Content Edge Cases (65–74)

65. Topic the model doesn't know well
66. "Create exactly 1 flashcard"
67. "Create 200 flashcards" (exact batch limit)
68. "Create 201 flashcards" (splits into 200+1)
69. Very long front/back content
70. Mathematical notation / LaTeX
71. Code snippets
72. Abstract concepts (justice, democracy)
73. Emoji/Unicode content
74. Single-word topic ("Japan", "DNA", "Pi")

## J. Tool-Specific Scenarios (75–82)

75. `ask_user` for clarification → user responds → continues
76. `create_plan` → execute → plan tracking updates in UI
77. `evaluate_quality` → returns passed/failed (no-op currently)
78. `fetch_material` → generate study content → extract flashcards
79. `webfetch` → extract concepts → generate flashcards
80. `finish(type='flashcards')` → consolidated view renders
81. `finish(type='chat')` → text response renders
82. Multiple tool calls without plan (3 or fewer)

## K. Edge Cases & Regressions (83–92)

83. Empty conversation
84. 20+ message conversation history
85. User sends only "?" or "..."
86. User pastes very long text
87. Multiple users (single-user, no issue — regression check)
88. Rapid-fire requests before agent finishes
89. Browser refresh mid-stream
90. Tab switching / app backgrounded
91. Plan with 10+ steps → UI overflow
92. 200 flashcards with very long text → grid overflow

## L. Regression Test Suites (93–100)

93. Same request sent twice (similar but not identical)
94. Markdown renders correctly after streaming fix
95. Plan is not instantly completed (step tracking)
96. Flashcard skeleton has correct proportions
97. Completed messages don't flip to streaming
98. `finish` with flashcards renders consolidated view
99. Intermediate batches show `readOnly = true`
100. Consolidated finish shows `readOnly = false`
