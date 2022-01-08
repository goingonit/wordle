/**
 * A script for finding the most devilish Wordle words in a given dictionary.
 * 
 * This script play out all possible games of Wordle assuming that the player uses the "Knuth
 * heuristic", a strategy that picks the guess that minimizes the number of possible
 * indistinguishable words given the worst-case output. Knuth 77 outlines this strategy for
 * Mastermind, and it applies nearly identically to Wordle.
 * 
 * Note that the Knuth heuristic is not 100% optimal -- it uses "number of possible words remaining"
 * as an estimate of game-tree depth -- but it's pretty darn good for Mastermind and we expect it to
 * be similarly good here.
 * 
 * To run the program:
 *   $ ts-node wordle.ts path/to/dictionary
 * 
 * The output will be a list of words coresponding to the worst-case series of guesses for the
 * supplied dictionary, the last of which will be the "correct" word that represents the worst
 * case for this strategy given the dictionary.
 */

import * as fs from 'fs/promises';

// The dictionary that we use (set by loadDict below).
const dict: string[] = [];

/** 
 * A guess result is a 5-digit hex number representing a unique Wordle result for a specific guess.
 */
type GuessResult = number;

const WORD_LENGTH = 5;

const RESULT_EXACT: GuessResult = 0x2;
const RESULT_SOMEWHERE: GuessResult = 0x1;
const RESULT_MISS: GuessResult = 0x0;

/** The GuessResult corresponding to 5 greens in a row. */
const RESULT_WIN: GuessResult = 0x22222;

/** A map from GuessResult to all the words that would return that result for a given guess. */
type ResultMap = Map<GuessResult, string[]>;

/** The state of the game right before a new guess. */
interface GameState {
    remainingWords: string[];  // All the possible words that haven't been ruled out.
    guessesSoFar: string[];  // The words we've already guessed.
}

/** Load a dictionary from the specified filename into the global "dict" array. */
const loadDict = async (dictFile: string) => {
    const fileContents = await fs.readFile(dictFile, {encoding: 'utf8'});
    for (const word of fileContents.split('\n')) {
        if (/^[a-z]{5}$/.test(word)) {
            dict.push(word);
        }
    }
}

/** Test a single guess against a single possible word, and see what result you get. */
const testGuess = (guess: string, word: string): GuessResult => {
    // We count occurrences of each letter in each word by storing two bits per letter
    // (this relies on never seeing the same letter >3x in one word!)
    // Each letter gets its own bit position (a=0, b=1, etc). Since there are 26 letters and 
    // JS does 32-bit bitwise arithmetic, we can fit one bit per letter in a single JS number.
    // "lo" stores the low bit of the count of a given letter while "hi" stores the high bit.
    // We increment the counter for the word at the start, and as we find those letters in the guess, 
    // we decrement the count until we hit zero.
    let remainingLettersLo = 0;
    let remainingLettersHi = 0;
    for (let i = 0; i < WORD_LENGTH; i++) {
        const charVal = 1 << (word.charCodeAt(i) - 97);
        if (remainingLettersHi & remainingLettersLo & charVal) {
            throw new Error(`Letter repeated 4x: ${word}`);
        }

        // Add charVal to remainingLetters using boolean operations.
        remainingLettersHi ^= (remainingLettersLo & charVal);
        remainingLettersLo ^= charVal;
    }
    let result: GuessResult = 0x0;  

    // First look for exact matches.
    for (let i = 0; i < WORD_LENGTH; i++) {
        const charVal = 1 << (guess.charCodeAt(i) - 97);
        if (guess[i] === word[i]) {
            result |= RESULT_EXACT << (i * 4);

            // Remove charVal from remainingLetters using boolean operations.
            remainingLettersHi ^= (~remainingLettersLo & charVal);
            remainingLettersLo ^= charVal;
        }
    }

    // Now look for non-exact matches.
    for (let i = 0; i < WORD_LENGTH; i++) {
        const charVal = 1 << (guess.charCodeAt(i) - 97);
        if (!(result & (RESULT_EXACT << (i * 4))) && ((remainingLettersHi | remainingLettersLo) & charVal)) {
            result |= RESULT_SOMEWHERE << (i*4);

            // Remove charVal from remainingLetters using boolean operations.
            remainingLettersHi ^= (~remainingLettersLo & charVal);
            remainingLettersLo ^= charVal;
        } 
    }
    return result;
}

/** Test all possible remaining words against a given guess. */
const testAllGuess = (state: GameState, guess: string): ResultMap => {
    const out: ResultMap = new Map<GuessResult, string[]>();
    for (const word of state.remainingWords) {
        const wordResult = testGuess(guess, word);
        let v = out.get(wordResult);
        if (!v) {
            v = [];
            out.set(wordResult, v);
        }
        v.push(word);
    }
    return out;
}

/** Find the largest "bucket" in the result map. */
const findMax = (results: ResultMap): number => {
    let out = 0;
    results.forEach(v => {
        if (v.length > out) {
            out = v.length;
        }
    });
    return out;
}

/** Find the best guess given the current game state. */
const findBestGuess = (state: GameState): {guess: string, results: ResultMap} => {
    let bestGuessResults: ResultMap = new Map();
    if (state.remainingWords.length === 1) {
        bestGuessResults.set(RESULT_WIN, [state.remainingWords[0]]);
        return {guess: state.remainingWords[0], results: bestGuessResults};
    }

    let bestGuess: string = '';
    bestGuessResults.set(0, state.remainingWords);
    let bestGuessMax: number = state.remainingWords.length;
    for (const word of dict) {
        if (state.guessesSoFar.includes(word)) {
            continue;
        }
        const resultMap = testAllGuess(state, word);
        const resultMax = findMax(resultMap);
        if ((resultMax < bestGuessMax) || (resultMax === bestGuessMax && resultMap.get(RESULT_WIN) && !bestGuessResults.get(RESULT_WIN))) {
            bestGuess = word;
            bestGuessResults = resultMap;
            bestGuessMax = resultMax;
        }
    }
    if (!bestGuess) {
        throw new Error('Unable to find a productive guess!');
    }
    return {guess: bestGuess, results: bestGuessResults};
}

/** 
 * Play out the entire game tree starting with the given game state.
 * 
 * Returns the guesses along the maximum-depth branch. */
const playToMaxDepth = (state: GameState): string[] => {
    let maxDepthChain: string[] = state.guessesSoFar;
    const {guess, results} = findBestGuess(state);
    results.forEach((v, result) => {
        let chain: string[];
        if (result === RESULT_WIN) {
            // If we got a win, we've made it to the end of the chain!
            chain = state.guessesSoFar.concat([guess]);
        } else {
            // Otherwise, recurse and make another guess.
            chain = playToMaxDepth({
                remainingWords: v,
                guessesSoFar: state.guessesSoFar.concat([guess]),
            });
        }
        if (chain.length > maxDepthChain.length) {
            maxDepthChain = chain;
        }
    });
    return maxDepthChain;
}

loadDict(process.argv[process.argv.length - 1]).then(() => {
    console.log(`${dict.length} words in dictionary. Starting...`);
    console.log(playToMaxDepth({guessesSoFar: [], remainingWords: dict}));
});
