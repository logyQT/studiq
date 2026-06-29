-- stats-test.sql
-- One year of organic seed data for dev student user
-- Topics: 7, Decks: 8, Flashcards: 100
-- Covers all 5 review states: new, learning, review, relearning, leech
-- Run via Supabase SQL editor or psql

-- ═══════════════════════════════════════════════
-- CONFIG
-- ═══════════════════════════════════════════════
DO $$
DECLARE
  v_user_id CONSTANT uuid := '00000000-0000-4000-8001-000000000004';
  v_now CONSTANT date := CURRENT_DATE;
  v_year_ago CONSTANT date := v_now - INTERVAL '1 year';

  v_topic_ids uuid[] := '{}'::uuid[];
  v_deck_ids uuid[] := '{}'::uuid[];
  v_flashcard_ids uuid[] := '{}'::uuid[];

  v_day date;
  v_review_count int;
  v_week_number int;
  v_week_weight numeric;
BEGIN
  -- ═══════════════════════════════════════════════
  -- CLEANUP
  -- ═══════════════════════════════════════════════
  DELETE FROM flashcard_practice WHERE user_id = v_user_id;
  DELETE FROM quiz_attempts WHERE user_id = v_user_id;
  DELETE FROM flashcard_review_state WHERE user_id = v_user_id;
  DELETE FROM user_daily_activity WHERE user_id = v_user_id;
  DELETE FROM flashcard_deck_assignments
    WHERE flashcard_id IN (SELECT id FROM flashcards WHERE created_by = v_user_id);
  DELETE FROM flashcard_topic_assignments
    WHERE flashcard_id IN (SELECT id FROM flashcards WHERE created_by = v_user_id);
  DELETE FROM flashcards WHERE created_by = v_user_id;
  DELETE FROM flashcard_decks WHERE created_by = v_user_id;

  -- Reset daily_review_goal
  UPDATE user_study_settings SET daily_review_goal = 50 WHERE user_id = v_user_id;

  -- ═══════════════════════════════════════════════
  -- TOPICS (7)
  -- ═══════════════════════════════════════════════
  INSERT INTO flashcard_topics (name, created_by) VALUES
    ('Biology', v_user_id),
    ('Chemistry', v_user_id),
    ('History', v_user_id),
    ('Math', v_user_id),
    ('Literature', v_user_id),
    ('Physics', v_user_id),
    ('Geography', v_user_id);

  SELECT array_agg(id) INTO v_topic_ids FROM flashcard_topics WHERE created_by = v_user_id;

  -- ═══════════════════════════════════════════════
  -- DECKS (8)
  -- ═══════════════════════════════════════════════
  INSERT INTO flashcard_decks (name, description, created_by) VALUES
    ('Exam Prep', 'Key concepts for final exams — well practiced', v_user_id),
    ('Chapter 1-3', 'Review material from first quarter', v_user_id),
    ('Review Pack', 'Mixed revision cards — moderate accuracy', v_user_id),
    ('Quick Facts', 'Short definition-style cards — high accuracy', v_user_id),
    ('Biology Deep', 'Advanced biology topics — moderate practice', v_user_id),
    ('Chem Formulas', 'Chemical formulas and reactions — lower accuracy', v_user_id),
    ('Recent Material', 'Brand new content added this week — fresh for learning', v_user_id),
    ('Stuck Cards', 'Persistently difficult cards — leech territory', v_user_id);

  SELECT array_agg(id) INTO v_deck_ids FROM flashcard_decks WHERE created_by = v_user_id;

  -- ═══════════════════════════════════════════════
  -- FLASHCARDS (100 total)
  -- ═══════════════════════════════════════════════
  -- Deck 1: Exam Prep (15 cards) — established, high accuracy
  INSERT INTO flashcards (front, back, created_by) VALUES
    ('Photosynthesis formula', '6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂', v_user_id),
    ('Mitosis phases in order', 'Prophase, Metaphase, Anaphase, Telophase', v_user_id),
    ('DNA base pairing rule', 'A-T, C-G (Adenine-Thymine, Cytosine-Guanine)', v_user_id),
    ('Central dogma of biology', 'DNA → RNA → Protein (transcription → translation)', v_user_id),
    ('Periodic table group count', '18 groups', v_user_id),
    ('pH of pure water', '7.0 (neutral)', v_user_id),
    ('World War I start year', '1914', v_user_id),
    ('Treaty of Versailles year', '1919', v_user_id),
    ('Quadratic formula', 'x = (-b ± √(b²-4ac)) / 2a', v_user_id),
    ('Pythagorean theorem formula', 'a² + b² = c²', v_user_id),
    ('Romeo and Juliet playwright', 'William Shakespeare (circa 1597)', v_user_id),
    ('Newton''s second law', 'F = ma', v_user_id),
    ('Speed of light in vacuum', '≈ 300,000 km/s (3×10⁸ m/s)', v_user_id),
    ('Largest ocean on Earth', 'Pacific Ocean', v_user_id),
    ('Capital of Australia', 'Canberra', v_user_id);

  -- Deck 2: Chapter 1-3 (15 cards) — established, moderate accuracy
  INSERT INTO flashcards (front, back, created_by) VALUES
    ('Cell theory tenets', 'All living things are composed of cells; cells are basic unit of life; cells arise from pre-existing cells', v_user_id),
    ('Atomic number definition', 'Number of protons in an atom''s nucleus', v_user_id),
    ('Mass number vs atomic number', 'Mass number = protons + neutrons; Atomic number = protons only', v_user_id),
    ('French Revolution start year', '1789', v_user_id),
    ('Napoleon''s final battle', 'Waterloo, 1815', v_user_id),
    ('Derivative of x²', '2x', v_user_id),
    ('Area of a circle formula', 'A = πr²', v_user_id),
    ('Oxidation definition', 'Loss of electrons', v_user_id),
    ('Covalent bond description', 'Shared pair of electrons between atoms', v_user_id),
    ('Metaphor definition', 'A figure of speech comparing two unlike things without "like" or "as"', v_user_id),
    ('Alliteration definition', 'Repetition of initial consonant sounds in nearby words', v_user_id),
    ('Velocity vs speed', 'Velocity is speed with direction (vector vs scalar)', v_user_id),
    ('Longest river in the world', 'The Nile (approximately 6,650 km)', v_user_id),
    ('Mount Everest height', '8,848 meters (29,029 feet)', v_user_id),
    ('Population of Earth', '≈ 8 billion (as of 2024)', v_user_id);

  -- Deck 3: Review Pack (15 cards) — mixed, lower accuracy
  INSERT INTO flashcards (front, back, created_by) VALUES
    ('Enzyme function', 'Biological catalysts that lower activation energy', v_user_id),
    ('H₂O chemical name', 'Dihydrogen monoxide (Water)', v_user_id),
    ('Cold War end year', '1991 (dissolution of Soviet Union)', v_user_id),
    ('Berlin Wall fall date', 'November 9, 1989', v_user_id),
    ('Slope formula', 'm = (y₂ - y₁) / (x₂ - x₁)', v_user_id),
    ('Circumference of a circle', 'C = 2πr', v_user_id),
    ('Reduction definition', 'Gain of electrons', v_user_id),
    ('Ionic bond description', 'Transfer of electrons from one atom to another', v_user_id),
    ('Protagonist definition', 'The main character driving the story', v_user_id),
    ('Foreshadowing definition', 'Hints or clues about events that occur later', v_user_id),
    ('Newton''s first law (inertia)', 'An object at rest stays at rest unless acted on by an external force', v_user_id),
    ('Acceleration formula', 'a = (v - u) / t (change in velocity over time)', v_user_id),
    ('Density formula', 'ρ = m / V (mass over volume)', v_user_id),
    ('Prime meridian location', 'Greenwich, London (0° longitude)', v_user_id),
    ('Capital of Canada', 'Ottawa', v_user_id);

  -- Deck 4: Quick Facts (15 cards) — high accuracy, well established
  INSERT INTO flashcards (front, back, created_by) VALUES
    ('Human body cell count', '≈ 37.2 trillion', v_user_id),
    ('Lightest element', 'Hydrogen (H, atomic number 1)', v_user_id),
    ('Magna Carta year', '1215', v_user_id),
    ('US Declaration of Independence year', '1776', v_user_id),
    ('Prime number definition', 'A number divisible only by 1 and itself', v_user_id),
    ('Boiling point of water (Celsius)', '100°C at sea level', v_user_id),
    ('Smallest planet', 'Mercury', v_user_id),
    ('Largest planet', 'Jupiter', v_user_id),
    ('Sonnet line count', '14 lines', v_user_id),
    ('Haiku syllable pattern', '5-7-5', v_user_id),
    ('Chemical symbol for gold', 'Au (from Latin aurum)', v_user_id),
    ('Chemical symbol for iron', 'Fe (from Latin ferrum)', v_user_id),
    ('Number of continents', '7 (Africa, Antarctica, Asia, Australia, Europe, North America, South America)', v_user_id),
    ('Tallest building', 'Burj Khalifa (828 m, Dubai)', v_user_id),
    ('Largest desert (non-polar)', 'Sahara Desert (≈ 9.2 million km²)', v_user_id);

  -- Deck 5: Biology Deep (12 cards)
  INSERT INTO flashcards (front, back, created_by) VALUES
    ('Krebs cycle location', 'Mitochondrial matrix', v_user_id),
    ('Electron transport chain output', 'Up to 34 ATP per glucose molecule', v_user_id),
    ('Glycolysis net ATP yield', '2 ATP (per glucose molecule)', v_user_id),
    ('RNA vs DNA sugar', 'RNA has ribose; DNA has deoxyribose', v_user_id),
    ('RNA base differences', 'Uracil (U) replaces Thymine (T) in RNA', v_user_id),
    ('Codon definition', 'A sequence of 3 mRNA nucleotides coding for one amino acid', v_user_id),
    ('Anticodon location', 'On tRNA molecule (complementary to mRNA codon)', v_user_id),
    ('Prokaryote vs eukaryote nucleus', 'Prokaryotes have no true nucleus; eukaryotes do', v_user_id),
    ('Cell membrane composition', 'Phospholipid bilayer with embedded proteins', v_user_id),
    ('Osmosis definition', 'Movement of water across semipermeable membrane', v_user_id),
    ('Function of ribosomes', 'Protein synthesis (translation)', v_user_id),
    ('Function of Golgi apparatus', 'Modifies, sorts, and packages proteins', v_user_id);

  -- Deck 6: Chem Formulas (10 cards) — lower accuracy
  INSERT INTO flashcards (front, back, created_by) VALUES
    ('Sulfuric acid formula', 'H₂SO₄', v_user_id),
    ('Hydrochloric acid formula', 'HCl', v_user_id),
    ('Sodium hydroxide formula', 'NaOH', v_user_id),
    ('Ammonia formula', 'NH₃', v_user_id),
    ('Methane formula', 'CH₄', v_user_id),
    ('Ethanol formula', 'C₂H₅OH', v_user_id),
    ('Avogadro''s number', '6.022 × 10²³', v_user_id),
    ('Ideal gas law', 'PV = nRT', v_user_id),
    ('Oxidation number of oxygen', 'Usually -2 (except in peroxides)', v_user_id),
    ('Balancing equations rule', 'Same number of each atom on both sides', v_user_id);

  -- Deck 7: Recent Material (10 cards) — fresh, few or no practices
  INSERT INTO flashcards (front, back, created_by) VALUES
    ('CRISPR-Cas9 function', 'Gene editing tool that cuts DNA at specific sequences', v_user_id),
    ('Quantum entanglement', 'Two particles behave as one system regardless of distance', v_user_id),
    ('Semantic differential scale', 'Rating scale between two bipolar adjectives', v_user_id),
    ('Dunning-Kruger effect', 'People with low ability overestimate their competence', v_user_id),
    ('Confirmation bias definition', 'Tendency to favor information confirming existing beliefs', v_user_id),
    ('Placebo effect', 'Positive response to inactive treatment due to expectation', v_user_id),
    ('Statistical significance (p-value)', 'p < 0.05 is conventionally significant', v_user_id),
    ('Standard deviation purpose', 'Measures spread of data around the mean', v_user_id),
    ('Correlation vs causation', 'Correlation does not imply causation', v_user_id),
    ('Double-blind study', 'Neither participant nor researcher knows group assignment', v_user_id);

  -- Deck 8: Stuck Cards (8 cards) — leech territory, low accuracy
  INSERT INTO flashcards (front, back, created_by) VALUES
    ('Heisenberg uncertainty principle', 'Cannot know both position and momentum exactly; Δx·Δp ≥ ħ/2', v_user_id),
    ('Entropy definition (second law)', 'Entropy of an isolated system always increases; ΔS ≥ 0', v_user_id),
    ('Le Chatelier''s principle', 'System at equilibrium shifts to counteract applied stress', v_user_id),
    ('Difference between innate and adaptive immunity', 'Innate is non-specific, immediate; adaptive is specific, has memory', v_user_id),
    ('Hypertonic vs hypotonic effect on cells', 'Hyper → water leaves (cell shrinks); Hypo → water enters (cell swells)', v_user_id),
    ('Mitosis vs meiosis result', 'Mitosis: 2 identical diploid cells; Meiosis: 4 unique haploid cells', v_user_id),
    ('SN1 vs SN2 reaction difference', 'SN1: unimolecular, carbocation intermediate; SN2: bimolecular, backside attack', v_user_id),
    ('Common ion effect', 'Solubility of a salt decreases when a common ion is added', v_user_id);

  SELECT array_agg(id ORDER BY id) INTO v_flashcard_ids FROM flashcards WHERE created_by = v_user_id;

  -- ═══════════════════════════════════════════════
  -- DECK ASSIGNMENTS (by position in deterministic ID order)
  -- ═══════════════════════════════════════════════
  -- Deck 1: cards 1-15, Deck 2: 16-30, Deck 3: 31-45, Deck 4: 46-60
  -- Deck 5: 61-72, Deck 6: 73-82, Deck 7: 83-92, Deck 8: 93-100
  FOR i IN 0..7 LOOP
    DECLARE
      v_start int;
      v_end   int;
    BEGIN
      v_start := i * 15 + 1;
      v_end := v_start + 14;
      IF i = 4 THEN v_start := 61; v_end := 72; END IF;
      IF i = 5 THEN v_start := 73; v_end := 82; END IF;
      IF i = 6 THEN v_start := 83; v_end := 92; END IF;
      IF i = 7 THEN v_start := 93; v_end := 100; END IF;

      INSERT INTO flashcard_deck_assignments (deck_id, flashcard_id)
      SELECT v_deck_ids[i+1], id
      FROM flashcards
      WHERE created_by = v_user_id
      ORDER BY id
      OFFSET v_start - 1 LIMIT (v_end - v_start + 1);
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════
  -- TOPIC ASSIGNMENTS (distribute by content keywords)
  -- ═══════════════════════════════════════════════
  INSERT INTO flashcard_topic_assignments (flashcard_id, topic_id)
  SELECT f.id, t.id
  FROM flashcards f, flashcard_topics t
  WHERE f.created_by = v_user_id
    AND (
      (t.name = 'Biology' AND (
        f.front ILIKE '%photosynthesis%' OR f.front ILIKE '%mitosis%' OR f.front ILIKE '%DNA%'
        OR f.front ILIKE '%cell%' OR f.front ILIKE '%enzyme%' OR f.front ILIKE '%body%'
        OR f.front ILIKE '%krebs%' OR f.front ILIKE '%glycolysis%' OR f.front ILIKE '%RNA%'
        OR f.front ILIKE '%codon%' OR f.front ILIKE '%anticodon%' OR f.front ILIKE '%prokaryote%'
        OR f.front ILIKE '%membrane%' OR f.front ILIKE '%osmosis%' OR f.front ILIKE '%ribosome%'
        OR f.front ILIKE '%golgi%' OR f.front ILIKE '%CRISPR%' OR f.front ILIKE '%immune%'
        OR f.front ILIKE '%hypertonic%' OR f.front ILIKE '%central dogma%'
      ))
      OR (t.name = 'Chemistry' AND (
        f.front ILIKE '%periodic%' OR f.front ILIKE '%pH%' OR f.front ILIKE '%atomic%'
        OR f.front ILIKE '%oxidation%' OR f.front ILIKE '%covalent%' OR f.front ILIKE '%ionic%'
        OR f.front ILIKE '%H₂O%' OR f.front ILIKE '%lightest%' OR f.front ILIKE '%boiling%'
        OR f.front ILIKE '%sulfuric%' OR f.front ILIKE '%hydrochloric%' OR f.front ILIKE '%sodium hydroxide%'
        OR f.front ILIKE '%ammonia%' OR f.front ILIKE '%methane%' OR f.front ILIKE '%ethanol%'
        OR f.front ILIKE '%avogadro%' OR f.front ILIKE '%ideal gas%' OR f.front ILIKE '%balancing%'
        OR f.front ILIKE '%Le Chatelier%' OR f.front ILIKE '%SN1%' OR f.front ILIKE '%SN2%'
        OR f.front ILIKE '%common ion%' OR f.front ILIKE '%reduction%' OR f.front ILIKE '%mass number%'
      ))
      OR (t.name = 'History' AND (
        f.front ILIKE '%world war%' OR f.front ILIKE '%treaty of versailles%' OR f.front ILIKE '%french revolution%'
        OR f.front ILIKE '%napoleon%' OR f.front ILIKE '%cold war%' OR f.front ILIKE '%berlin wall%'
        OR f.front ILIKE '%magna carta%' OR f.front ILIKE '%declaration of independence%'
      ))
      OR (t.name = 'Math' AND (
        f.front ILIKE '%quadratic%' OR f.front ILIKE '%pythagorean%' OR f.front ILIKE '%derivative%'
        OR f.front ILIKE '%area of a circle%' OR f.front ILIKE '%slope%' OR f.front ILIKE '%circumference%'
        OR f.front ILIKE '%prime number%' OR f.front ILIKE '%prime meridian%'
        OR f.front ILIKE '%standard deviation%' OR f.front ILIKE '%statistical significance%'
        OR f.front ILIKE '%correlation%'
      ))
      OR (t.name = 'Literature' AND (
        f.front ILIKE '%romeo%' OR f.front ILIKE '%metaphor%' OR f.front ILIKE '%alliteration%'
        OR f.front ILIKE '%protagonist%' OR f.front ILIKE '%foreshadowing%' OR f.front ILIKE '%sonnet%'
        OR f.front ILIKE '%haiku%'
      ))
      OR (t.name = 'Physics' AND (
        f.front ILIKE '%newton%' OR f.front ILIKE '%speed of light%' OR f.front ILIKE '%velocity%'
        OR f.front ILIKE '%acceleration%' OR f.front ILIKE '%density%'
        OR f.front ILIKE '%heisenberg%' OR f.front ILIKE '%entropy%' OR f.front ILIKE '%quantum entanglement%'
      ))
      OR (t.name = 'Geography' AND (
        f.front ILIKE '%largest ocean%' OR f.front ILIKE '%capital of australia%'
        OR f.front ILIKE '%longest river%' OR f.front ILIKE '%mount everest%'
        OR f.front ILIKE '%population%' OR f.front ILIKE '%capital of canada%'
        OR f.front ILIKE '%largest planet%' OR f.front ILIKE '%smallest planet%'
        OR f.front ILIKE '%number of continents%' OR f.front ILIKE '%tallest building%'
        OR f.front ILIKE '%sahara%'
      ))
    );

  -- Remaining unassigned cards → Biology (catch-all for science)
  INSERT INTO flashcard_topic_assignments (flashcard_id, topic_id)
  SELECT f.id, v_topic_ids[1]
  FROM flashcards f
  WHERE f.created_by = v_user_id
    AND NOT EXISTS (
      SELECT 1 FROM flashcard_topic_assignments fta WHERE fta.flashcard_id = f.id
    );

  -- ═══════════════════════════════════════════════
  -- PRACTICE DATA — THREE GROUPS WITH DIFFERENT PATTERNS
  -- ═══════════════════════════════════════════════

  -- Group A: Cards in decks 1-6 — daily practice across the full year
  FOR v_day IN SELECT generate_series(v_year_ago, v_now - INTERVAL '4 days', '1 day')::date LOOP
    v_week_number := EXTRACT(WEEK FROM v_day)::int;

    IF EXTRACT(DOW FROM v_day) IN (0, 6) THEN
      v_week_weight := 0.4;
    ELSE
      v_week_weight := 1.0;
    END IF;

    IF v_week_number IN (4, 8, 24, 36) THEN
      v_week_weight := v_week_weight * 2.0;
    END IF;

    v_review_count := GREATEST(5, (10 + floor(random() * 31)::int) * v_week_weight);

    INSERT INTO flashcard_practice (user_id, flashcard_id, was_correct, practiced_at)
    SELECT
      v_user_id,
      fda.flashcard_id,
      CASE
        WHEN fda.deck_id = ANY(v_deck_ids[1:4]) THEN random() < 0.85   -- Decks 1-4: ~85% accuracy
        WHEN fda.deck_id = v_deck_ids[5] THEN random() < 0.70           -- Deck 5: ~70%
        ELSE random() < 0.60                                             -- Deck 6: ~60%
      END,
      v_day + (random() * INTERVAL '14 hours')
    FROM flashcard_deck_assignments fda
    WHERE fda.deck_id = ANY(v_deck_ids[1:6])
    ORDER BY random()
    LIMIT v_review_count;
  END LOOP;

  -- Group B: Deck 7 (Recent Material) — 0-2 practices in last 3 days
  FOR v_day IN SELECT generate_series(v_now - INTERVAL '3 days', v_now, '1 day')::date LOOP
    INSERT INTO flashcard_practice (user_id, flashcard_id, was_correct, practiced_at)
    SELECT
      v_user_id,
      fda.flashcard_id,
      random() < 0.5 + (random() * 0.4),
      v_day + (random() * INTERVAL '8 hours')
    FROM flashcard_deck_assignments fda
    WHERE fda.deck_id = v_deck_ids[7]
    ORDER BY random()
    LIMIT (1 + floor(random() * 3))::int;
  END LOOP;

  -- Group C: Deck 8 (Stuck Cards) — heavy practice, low accuracy, last 6 months
  FOR v_day IN SELECT generate_series(v_now - INTERVAL '6 months', v_now - INTERVAL '3 days', '1 day')::date LOOP
    v_week_number := EXTRACT(WEEK FROM v_day)::int;

    IF EXTRACT(DOW FROM v_day) IN (0, 6) THEN
      v_week_weight := 0.5;
    ELSE
      v_week_weight := 1.5;
    END IF;

    v_review_count := GREATEST(3, (8 + floor(random() * 21)::int) * v_week_weight);

    INSERT INTO flashcard_practice (user_id, flashcard_id, was_correct, practiced_at)
    SELECT
      v_user_id,
      fda.flashcard_id,
      random() < 0.30 + (random() * 0.20),  -- ~40% accuracy (mostly wrong)
      v_day + (random() * INTERVAL '14 hours')
    FROM flashcard_deck_assignments fda
    WHERE fda.deck_id = v_deck_ids[8]
    ORDER BY random()
    LIMIT v_review_count;
  END LOOP;

  -- ═══════════════════════════════════════════════
  -- DERIVE REVIEW STATE FROM PRACTICE HISTORY
  -- ═══════════════════════════════════════════════
  FOR i IN 1..array_length(v_flashcard_ids, 1) LOOP
    DECLARE
      v_card_id CONSTANT uuid := v_flashcard_ids[i];
      v_total int;
      v_correct int;
      v_accuracy numeric;
      v_last_practiced timestamptz;
      v_reps int;
      v_ef numeric;
      v_interval int;
      v_state text;
      v_leech boolean;
      v_lapses int;
    BEGIN
      SELECT COUNT(*), COUNT(*) FILTER (WHERE was_correct), MAX(practiced_at)
      INTO v_total, v_correct, v_last_practiced
      FROM flashcard_practice
      WHERE user_id = v_user_id AND flashcard_id = v_card_id;

      IF v_total = 0 THEN
        v_state := 'new';
        v_ef := 2.5;
        v_interval := 0;
        v_reps := 0;
        v_leech := false;
        v_lapses := 0;
      ELSE
        v_accuracy := v_correct::numeric / v_total;
        v_reps := v_total;
        v_ef := GREATEST(1.3, LEAST(3.0, 2.5 + (v_accuracy - 0.8) * 2.0));
        v_interval := LEAST(365, POWER(2, LEAST(v_reps, 8))::int);
        v_lapses := v_total - v_correct;

        IF v_accuracy >= 0.8 AND v_reps >= 3 THEN
          v_state := 'review';
        ELSIF v_accuracy < 0.6 AND v_reps >= 5 THEN
          v_state := 'relearning';
          v_leech := v_reps >= 8;
        ELSIF v_reps >= 1 THEN
          v_state := 'learning';
        ELSE
          v_state := 'new';
        END IF;

        v_leech := v_reps >= 6 AND v_accuracy < 0.55;
      END IF;

      INSERT INTO flashcard_review_state (
        user_id, flashcard_id,
        easiness_factor, interval_days, repetitions,
        next_review_at, last_reviewed_at, last_quality,
        learning_state, learning_step, lapse_count, is_leech
      ) VALUES (
        v_user_id, v_card_id,
        v_ef, v_interval, v_reps,
        COALESCE(v_last_practiced + (v_interval || ' days')::interval, NOW()),
        v_last_practiced,
        CASE WHEN v_accuracy >= 0.8 THEN 4 WHEN v_accuracy >= 0.6 THEN 3 WHEN v_accuracy >= 0.4 THEN 2 ELSE 1 END,
        v_state,
        LEAST(v_reps, 10),
        v_lapses,
        COALESCE(v_leech, false)
      )
      ON CONFLICT (user_id, flashcard_id) DO UPDATE SET
        easiness_factor = EXCLUDED.easiness_factor,
        interval_days = EXCLUDED.interval_days,
        repetitions = EXCLUDED.repetitions,
        next_review_at = EXCLUDED.next_review_at,
        last_reviewed_at = EXCLUDED.last_reviewed_at,
        learning_state = EXCLUDED.learning_state,
        is_leech = EXCLUDED.is_leech;
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════
  -- QUIZ ATTEMPTS (~1 per week across the year)
  -- ═══════════════════════════════════════════════
  FOR v_day IN SELECT generate_series(v_year_ago + INTERVAL '7 days', v_now, '7 days')::date LOOP
    DECLARE
      v_quiz_total int;
      v_quiz_score int;
    BEGIN
      v_quiz_total := 5 + floor(random() * 16)::int;
      v_quiz_score := ceil(v_quiz_total * (0.6 + random() * 0.35))::int;

      INSERT INTO quiz_attempts (user_id, score, total_questions, started_at, completed_at, config)
      VALUES (
        v_user_id,
        v_quiz_score,
        v_quiz_total,
        v_day + (random() * INTERVAL '4 hours'),
        v_day + INTERVAL '30 minutes' + (random() * INTERVAL '15 minutes'),
        '{"mode": "practice", "shuffle": true}'::jsonb
      );
    END;
  END LOOP;

  -- ═══════════════════════════════════════════════
  -- BACKFILL user_daily_activity
  -- ═══════════════════════════════════════════════
  INSERT INTO user_daily_activity (user_id, date, reviews_count, reviews_correct)
  SELECT user_id, practiced_at::date, COUNT(*), COUNT(*) FILTER (WHERE was_correct)
  FROM flashcard_practice WHERE user_id = v_user_id
  GROUP BY user_id, practiced_at::date
  ON CONFLICT (user_id, date) DO UPDATE SET
    reviews_count = EXCLUDED.reviews_count,
    reviews_correct = EXCLUDED.reviews_correct;

  INSERT INTO user_daily_activity (user_id, date, quizzes_count, quizzes_score, quizzes_total)
  SELECT user_id, completed_at::date, COUNT(*), COALESCE(SUM(score), 0), COALESCE(SUM(total_questions), 0)
  FROM quiz_attempts WHERE user_id = v_user_id
  GROUP BY user_id, completed_at::date
  ON CONFLICT (user_id, date) DO UPDATE SET
    quizzes_count = EXCLUDED.quizzes_count,
    quizzes_score = EXCLUDED.quizzes_score,
    quizzes_total = EXCLUDED.quizzes_total;

  RAISE NOTICE 'Seed complete: % flashcards, % practice records, % quiz attempts, % daily activity rows',
    (SELECT COUNT(*) FROM flashcards WHERE created_by = v_user_id),
    (SELECT COUNT(*) FROM flashcard_practice WHERE user_id = v_user_id),
    (SELECT COUNT(*) FROM quiz_attempts WHERE user_id = v_user_id),
    (SELECT COUNT(*) FROM user_daily_activity WHERE user_id = v_user_id);
END $$;
