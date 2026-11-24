/*
 * The settings of library #53 ("SOXL, TQQQ, QQQ - 1983 fit") that its feature tests were written
 * at: the round fit of 21 November 2026 with the late-week rules of 24 November. #53's own
 * defaults moved twice on 24 November 2026 (the user's two fits of that day; the second made a
 * switch between two funds one close). #71 (Steady fit) was built
 * from #53 before that and keeps these values. A test of a mechanism (the bear exit, the SOXL
 * turn sale, Steady fit against #53 changed by hand) lays them over #53's defaults, so it keeps
 * checking the ground it was written for whatever #53 ships with.
 *
 *   const { testDefaults } = require('./fit-round-settings.cjs');
 */
const FIT = 53;
const FIT_ROUND_SETTINGS = {
  lookbackDays: 540, startAvgDays: 60, topLead: 125, topHold: 'sqqq', topDays: 20, backLead: 35, bearSlope: 20, bearCloses: 15,
  overWindow: 255, sqqqMaxDays: 15, soxlLeadDays: 420, soxlLeadEnter: -20, soxlLeadExit: 195, soxlPile: true,
  bigDrop: 25, dipDay: 4, dipUnder: 35, dipSellDay: 1, lateRsiSkip: true, lateTrend: false, lateTrendDays: 30,
  splitDays: true,
};
// A strategy's defaults as a test takes them: #53's with the round fit laid over them, any other entry's as they are.
const testDefaults = (n, defaults) => (n === FIT ? { ...defaults, ...FIT_ROUND_SETTINGS } : defaults);

module.exports = { FIT_ROUND_SETTINGS, testDefaults };
