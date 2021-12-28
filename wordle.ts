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
 * A guess result is a number representing a unique Wordle result for a specific guess.
 * 
 * A guess is represented as a 5-character string, with exact (green) matches represented
 * as 'G', yellow as 'Y', and grey as ' '.
 */
type GuessResult = string;

const WORD_LENGTH = 5;

const RESULT_EXACT: GuessResult = 'G'
const RESULT_SOMEWHERE: GuessResult = 'Y';
const RESULT_MISS: GuessResult = ' ';

/** The GuessResult corresponding to 5 greens in a row. */
const RESULT_WIN: GuessResult = 'GGGGG';

/** A map from GuessResult to all the words that would return that result for a given guess. */
type ResultMap = {[result: GuessResult]: string[]};

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
    // remainingLetters records how many letters in the possible word haven't yet been recorded
    // as an exact or partial match against the guess. This is stored as an array of up to length 26,
    // where a = 0, b = 1, etc.
    let remainingLetters: number[] = [];
    let result: GuessResult = '';
    for (let i = 0; i < WORD_LENGTH; i++) {
        remainingLetters[word.charCodeAt(i) - 97] = remainingLetters[word.charCodeAt(i) - 97] || 0 + 1;
    } 
    for (let i = 0; i < WORD_LENGTH; i++) {
        if (guess[i] === word[i]) {
            result += RESULT_EXACT;
            remainingLetters[guess.charCodeAt(i) - 97]--;
        } else if (remainingLetters[guess.charCodeAt(i) - 97]) {
            result += RESULT_SOMEWHERE;
            remainingLetters[guess.charCodeAt(i) - 97]--;
        } else {
            result += RESULT_MISS;
        }
    }
    return result;
}

/** Test all possible remaining words against a given guess. */
const testAllGuess = (state: GameState, guess: string): ResultMap => {
    const out: ResultMap = {};
    for (const word of state.remainingWords) {
        const wordResult = testGuess(guess, word);
        if (!out[wordResult]) {
            out[wordResult] = [];
        }
        out[wordResult].push(word);
    }
    return out;
}

/** Find the largest "bucket" in the result map. */
const findMax = (results: ResultMap): number => {
    let out = 0;
    for (const k in results) {
        if (results[k].length > out) {
            out = results[k].length;
        }
    }
    return out;
}

/** Find the best guess given the current game state. */
const findBestGuess = (state: GameState): {guess: string, results: ResultMap} => {
    if (state.remainingWords.length === 1) {
        return {guess: state.remainingWords[0], results: {[RESULT_WIN]: [state.remainingWords[0]]}};
    }

    let bestGuess: string = '';
    let bestGuessResults: ResultMap = {0: state.remainingWords};
    let bestGuessMax: number = state.remainingWords.length;
    for (const word of dict) {
        if (state.guessesSoFar.includes(word)) {
            continue;
        }
        const resultMap = testAllGuess(state, word);
        const resultMax = findMax(resultMap);
        if ((resultMax < bestGuessMax) || (resultMax === bestGuessMax && resultMap[RESULT_WIN] && !bestGuessResults[RESULT_WIN])) {
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
    for (const result in results) {
        let chain: string[];
        if (result === RESULT_WIN) {
            // If we got a win, we've made it to the end of the chain!
            chain = state.guessesSoFar.concat([guess]);
        } else {
            // Otherwise, recurse and make another guess.
            chain = playToMaxDepth({
                remainingWords: results[result],
                guessesSoFar: state.guessesSoFar.concat([guess]),
            });
        }
        if (chain.length > maxDepthChain.length) {
            maxDepthChain = chain;
        }
    }
    return maxDepthChain;
}

loadDict(process.argv[process.argv.length - 1]).then(() => {
    console.log(`${dict.length} words in dictionary. Starting...`);
    console.log(playToMaxDepth({guessesSoFar: [], remainingWords: dict}));
});
