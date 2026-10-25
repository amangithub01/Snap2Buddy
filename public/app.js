/**
 * Snap2Study - Frontend Logic
 * Strictly uses safe DOM manipulation (textContent / createElement) to prevent XSS.
 * No raw innerHTML with model output.
 */

(function () {
  'use strict';

  // DOM Elements
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const sampleBtn = document.getElementById('sampleBtn');
  const dropZonePrompt = document.getElementById('dropZonePrompt');
  const previewContainer = document.getElementById('previewContainer');
  const previewImg = document.getElementById('previewImg');
  const previewScanner = document.getElementById('previewScanner');
  const previewFileName = document.getElementById('previewFileName');
  const previewFileSize = document.getElementById('previewFileSize');
  const removeImgBtn = document.getElementById('removeImgBtn');
  const difficultySelect = document.getElementById('difficultySelect');
  const generateBtn = document.getElementById('generateBtn');

  // Loading, Error, Results sections
  const loadingSection = document.getElementById('loadingSection');
  const errorSection = document.getElementById('errorSection');
  const errorTitle = document.getElementById('errorTitle');
  const errorMessage = document.getElementById('errorMessage');
  const tryAgainBtn = document.getElementById('tryAgainBtn');
  const resultsSection = document.getElementById('resultsSection');
  const modelUsedBadge = document.getElementById('modelUsedBadge');
  const newKitBtn = document.getElementById('newKitBtn');

  // Results sub-elements
  const kitTitle = document.getElementById('kitTitle');
  const kitSummary = document.getElementById('kitSummary');
  const conceptsList = document.getElementById('conceptsList');
  const flashcardsGrid = document.getElementById('flashcardsGrid');
  const flipAllCardsBtn = document.getElementById('flipAllCardsBtn');
  const quizContainer = document.getElementById('quizContainer');
  const scoreValue = document.getElementById('scoreValue');

  // Follow-up form
  const followupForm = document.getElementById('followupForm');
  const followupInput = document.getElementById('followupInput');
  const askBtn = document.getElementById('askBtn');
  const followupAnswerBox = document.getElementById('followupAnswerBox');
  const followupAnswerText = document.getElementById('followupAnswerText');

  // State
  let currentFile = null;
  let currentBase64 = null;
  let currentMimeType = null;
  let currentStudyKit = null;
  let quizScore = 0;
  let answeredQuizCount = 0;
  let allCardsFlipped = false;

  const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Safely set text content of an element.
   */
  function setText(element, text) {
    if (element) {
      element.textContent = text == null ? '' : String(text);
    }
  }

  /**
   * Format file size nicely
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ==========================================================================
  // Image Loading & Handling
  // ==========================================================================

  function handleFileSelected(file) {
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type.toLowerCase())) {
      showError(
        'Invalid File Format',
        'Please upload an image in JPG, PNG, or WEBP format.'
      );
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      showError(
        'File Too Large',
        `The selected image (${formatBytes(file.size)}) exceeds the maximum allowed size of 8 MB.`
      );
      return;
    }

    currentFile = file;
    currentMimeType = file.type;

    const reader = new FileReader();
    reader.onload = function (e) {
      currentBase64 = e.target.result;
      displayImagePreview(file.name, file.size, currentBase64);
    };
    reader.onerror = function () {
      showError('Read Error', 'Failed to read image file. Please try another image.');
    };
    reader.readAsDataURL(file);
  }

  function displayImagePreview(name, size, dataUrl) {
    setText(previewFileName, name);
    setText(previewFileSize, formatBytes(size));
    previewImg.src = dataUrl;

    dropZonePrompt.classList.add('hidden');
    previewContainer.classList.remove('hidden');
    generateBtn.disabled = false;
    hideError();
  }

  function resetImage() {
    currentFile = null;
    currentBase64 = null;
    currentMimeType = null;
    fileInput.value = '';
    previewImg.src = '';
    previewContainer.classList.add('hidden');
    dropZonePrompt.classList.remove('hidden');
    generateBtn.disabled = true;
  }

  // ==========================================================================
  // Sample Notes Loader
  // ==========================================================================

  async function loadSampleNotes() {
    try {
      generateBtn.disabled = true;
      const response = await fetch('/samples/sample_notes.jpg');
      if (!response.ok) {
        throw new Error('Sample image file not found.');
      }
      const blob = await response.blob();
      const file = new File([blob], 'cellular_respiration_notes.jpg', { type: 'image/jpeg' });
      handleFileSelected(file);
    } catch (err) {
      showError('Sample Notes Error', 'Could not load sample notes: ' + err.message);
    }
  }

  // ==========================================================================
  // Drag & Drop Listeners
  // ==========================================================================

  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  sampleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    loadSampleNotes();
  });

  removeImgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetImage();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) {
      handleFileSelected(dt.files[0]);
    }
  });

  dropZone.addEventListener('click', (e) => {
    // If user clicked inside dropzone but not on child action buttons
    if (e.target.closest('#browseBtn') || e.target.closest('#sampleBtn') || e.target.closest('#removeImgBtn')) {
      return;
    }
    if (!currentFile) {
      fileInput.click();
    }
  });

  // ==========================================================================
  // Study Kit Generation
  // ==========================================================================

  async function generateStudyKit() {
    if (!currentBase64 || !currentMimeType) {
      showError('Image Required', 'Please upload or select notes first.');
      return;
    }

    const difficulty = difficultySelect.value || 'Intermediate';

    // Show loading UI
    showLoading();

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: currentBase64,
          mimeType: currentMimeType,
          difficulty: difficulty
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server responded with status ${response.status}`);
      }

      // Check if model returned readable study content error
      if (data.isContentError || data.error) {
        showError(
          'No Readable Study Content',
          data.error || 'No readable study content found in this image. Please upload a clear photo of handwritten notes or study diagrams.'
        );
        return;
      }

      currentStudyKit = data;
      renderStudyKit(data);
    } catch (err) {
      console.error('Generation error:', err);
      showError(
        'Study Kit Generation Failed',
        err.message || 'Unable to generate study kit. Please check your image or server configuration and try again.'
      );
    } finally {
      hideLoading();
    }
  }

  generateBtn.addEventListener('click', generateStudyKit);
  tryAgainBtn.addEventListener('click', () => {
    hideError();
    if (currentBase64) {
      generateStudyKit();
    }
  });

  newKitBtn.addEventListener('click', () => {
    resultsSection.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ==========================================================================
  // Render Results (Safe DOM Creation)
  // ==========================================================================

  function renderStudyKit(kit) {
    hideError();

    // 1. Model Badge
    const modelUsedText = kit.modelUsed
      ? `Generated by Gemma 4 (${kit.modelUsed})`
      : 'Generated by Gemma 4';
    setText(modelUsedBadge, modelUsedText);

    // 2. Title & Plain-Language Summary
    setText(kitTitle, kit.title || 'Study Kit');
    setText(kitSummary, kit.summary || '');

    // 3. Key Concepts (5-8 bullet points)
    conceptsList.replaceChildren(); // Safely clear all children
    if (Array.isArray(kit.key_concepts) && kit.key_concepts.length > 0) {
      kit.key_concepts.forEach((concept) => {
        const li = document.createElement('li');
        li.className = 'concept-item';

        // Bullet icon
        const iconSpan = document.createElement('span');
        iconSpan.className = 'concept-bullet-icon';
        iconSpan.textContent = '✦';

        // Text span (safe text assignment)
        const textSpan = document.createElement('span');
        textSpan.className = 'concept-text';
        textSpan.textContent = concept;

        li.appendChild(iconSpan);
        li.appendChild(textSpan);
        conceptsList.appendChild(li);
      });
    }

    // 4. Flashcards (6 cards in a grid)
    flashcardsGrid.replaceChildren();
    allCardsFlipped = false;
    setText(flipAllCardsBtn, 'Flip All Cards 🔄');

    if (Array.isArray(kit.flashcards) && kit.flashcards.length > 0) {
      kit.flashcards.forEach((card, index) => {
        const cardElem = createFlashcardElement(card.q, card.a, index + 1, kit.flashcards.length);
        flashcardsGrid.appendChild(cardElem);
      });
    }

    // 5. Quiz (4 multiple choice questions)
    quizContainer.replaceChildren();
    quizScore = 0;
    answeredQuizCount = 0;
    setText(scoreValue, `0/${Array.isArray(kit.quiz) ? kit.quiz.length : 4}`);

    if (Array.isArray(kit.quiz) && kit.quiz.length > 0) {
      kit.quiz.forEach((qItem, qIndex) => {
        const quizCard = createQuizElement(qItem, qIndex);
        quizContainer.appendChild(quizCard);
      });
    }

    // Reset follow-up box
    followupForm.reset();
    followupAnswerBox.classList.add('hidden');
    setText(followupAnswerText, '');

    // Show results section
    resultsSection.classList.remove('hidden');

    // Smooth scroll to results
    setTimeout(() => {
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  // ==========================================================================
  // Flashcard Builder (Safe DOM & 3D Flip)
  // ==========================================================================

  function createFlashcardElement(questionText, answerText, cardIndex, totalCards) {
    const card = document.createElement('div');
    card.className = 'flashcard';
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Flashcard ${cardIndex}: click to flip`);

    const inner = document.createElement('div');
    inner.className = 'flashcard-inner';

    // --- FRONT SIDE (Question) ---
    const front = document.createElement('div');
    front.className = 'flashcard-front';

    const frontHeader = document.createElement('div');
    frontHeader.className = 'card-badge-row';

    const frontNum = document.createElement('span');
    frontNum.className = 'card-num-tag';
    frontNum.textContent = `Card ${cardIndex} of ${totalCards}`;

    const flipPrompt = document.createElement('span');
    flipPrompt.className = 'card-flip-prompt';
    flipPrompt.textContent = 'Click to flip 🔄';

    frontHeader.appendChild(frontNum);
    frontHeader.appendChild(flipPrompt);

    const qTextElem = document.createElement('p');
    qTextElem.className = 'card-text-q';
    qTextElem.textContent = questionText || '';

    front.appendChild(frontHeader);
    front.appendChild(qTextElem);

    // --- BACK SIDE (Answer) ---
    const back = document.createElement('div');
    back.className = 'flashcard-back';

    const backHeader = document.createElement('div');
    backHeader.className = 'card-badge-row';

    const backNum = document.createElement('span');
    backNum.className = 'card-num-tag-back';
    backNum.textContent = `Answer • Card ${cardIndex}`;

    const backPrompt = document.createElement('span');
    backPrompt.className = 'card-flip-prompt';
    backPrompt.textContent = 'Flip back 🔄';

    backHeader.appendChild(backNum);
    backHeader.appendChild(backPrompt);

    const aTextElem = document.createElement('p');
    aTextElem.className = 'card-text-a';
    aTextElem.textContent = answerText || '';

    back.appendChild(backHeader);
    back.appendChild(aTextElem);

    inner.appendChild(front);
    inner.appendChild(back);
    card.appendChild(inner);

    // Click handler to toggle flip
    card.addEventListener('click', () => {
      card.classList.toggle('is-flipped');
    });

    // Keyboard accessibility (Enter or Space to flip)
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.classList.toggle('is-flipped');
      }
    });

    return card;
  }

  // Toggle flip on all cards
  flipAllCardsBtn.addEventListener('click', () => {
    allCardsFlipped = !allCardsFlipped;
    const cards = flashcardsGrid.querySelectorAll('.flashcard');
    cards.forEach((c) => {
      if (allCardsFlipped) {
        c.classList.add('is-flipped');
      } else {
        c.classList.remove('is-flipped');
      }
    });
    setText(flipAllCardsBtn, allCardsFlipped ? 'Flip Front 🔄' : 'Flip All Cards 🔄');
  });

  // ==========================================================================
  // Quiz Builder (Safe DOM, Score Tracker, Instant Feedback)
  // ==========================================================================

  function createQuizElement(quizItem, qIndex) {
    const card = document.createElement('div');
    card.className = 'quiz-item-card';

    // Question Header
    const header = document.createElement('div');
    header.className = 'quiz-question-header';

    const indexBadge = document.createElement('span');
    indexBadge.className = 'quiz-q-index';
    indexBadge.textContent = String(qIndex + 1);

    const questionTitle = document.createElement('h3');
    questionTitle.className = 'quiz-q-title';
    questionTitle.textContent = quizItem.question || '';

    header.appendChild(indexBadge);
    header.appendChild(questionTitle);
    card.appendChild(header);

    // Options Container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'quiz-options-list';

    const prefixes = ['A', 'B', 'C', 'D'];
    const optionButtons = [];
    let isAnswered = false;

    // Explanation Box (initially hidden)
    const explanationBox = document.createElement('div');
    explanationBox.className = 'quiz-explanation-box hidden';

    const explTitle = document.createElement('div');
    explTitle.className = 'explanation-title';
    explTitle.textContent = 'Explanation:';

    const explText = document.createElement('div');
    explText.className = 'explanation-text';
    explText.textContent = quizItem.explanation || 'Based on the uploaded study materials.';

    explanationBox.appendChild(explTitle);
    explanationBox.appendChild(explText);

    // Option Buttons
    const options = Array.isArray(quizItem.options) ? quizItem.options : [];
    options.forEach((optText, optIndex) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option-btn';

      const prefixSpan = document.createElement('span');
      prefixSpan.className = 'option-prefix';
      prefixSpan.textContent = prefixes[optIndex] || String(optIndex + 1);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'option-label';
      labelSpan.textContent = optText;

      btn.appendChild(prefixSpan);
      btn.appendChild(labelSpan);

      btn.addEventListener('click', () => {
        if (isAnswered) return;
        isAnswered = true;

        const isCorrect = optIndex === quizItem.answer_index;

        if (isCorrect) {
          btn.classList.add('state-correct');
          quizScore += 1;
        } else {
          btn.classList.add('state-wrong');
          // Highlight correct answer in green
          if (optionButtons[quizItem.answer_index]) {
            optionButtons[quizItem.answer_index].classList.add('state-correct');
          }
        }

        // Disable all option buttons in this question
        optionButtons.forEach((b) => {
          b.disabled = true;
          b.style.cursor = 'default';
        });

        // Reveal explanation
        explanationBox.classList.remove('hidden');

        // Update running score
        answeredQuizCount += 1;
        const total = currentStudyKit?.quiz?.length || 4;
        setText(scoreValue, `${quizScore}/${total}`);
      });

      optionButtons.push(btn);
      optionsContainer.appendChild(btn);
    });

    card.appendChild(optionsContainer);
    card.appendChild(explanationBox);

    return card;
  }

  // ==========================================================================
  // Follow-up Question Handler
  // ==========================================================================

  followupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = followupInput.value.trim();
    if (!query) return;

    if (!currentBase64 || !currentMimeType) {
      showError('Image Missing', 'Image context was lost. Please re-upload your notes.');
      return;
    }

    askBtn.disabled = true;
    setText(askBtn.querySelector('span'), 'Asking Gemma…');
    followupAnswerBox.classList.remove('hidden');
    setText(followupAnswerText, 'Gemma is reviewing the notes image to answer your question...');

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: currentBase64,
          mimeType: currentMimeType,
          question: query
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to answer follow-up question.');
      }

      setText(followupAnswerText, data.answer || 'No answer returned.');
    } catch (err) {
      setText(followupAnswerText, 'Error: ' + (err.message || 'Could not get an answer. Please try again.'));
    } finally {
      askBtn.disabled = false;
      setText(askBtn.querySelector('span'), 'Ask Gemma');
    }
  });

  // ==========================================================================
  // Loading & Error State Helpers
  // ==========================================================================

  function showLoading() {
    hideError();
    loadingSection.classList.remove('hidden');
    previewScanner.classList.remove('hidden');
    generateBtn.disabled = true;
    setText(generateBtn.querySelector('.btn-text'), 'Reading Page…');
  }

  function hideLoading() {
    loadingSection.classList.add('hidden');
    previewScanner.classList.add('hidden');
    generateBtn.disabled = false;
    setText(generateBtn.querySelector('.btn-text'), 'Generate Study Kit');
  }

  function showError(title, message) {
    setText(errorTitle, title);
    setText(errorMessage, message);
    errorSection.classList.remove('hidden');
    errorSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideError() {
    errorSection.classList.add('hidden');
  }

  // Initial check on page load
  async function checkServerStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (!data.configured) {
        console.warn('GEMINI_API_KEY is not configured in the server environment (.env).');
      }
    } catch (e) {
      console.warn('Could not contact backend API status:', e);
    }
  }

  checkServerStatus();
})();
