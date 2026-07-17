{
  name: "50/50 QQQ + TQQQ (yearly rebalance)",
  params: [
    { id: "rebalMonth", label: "Rebalance month", options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], default: 1 }
  ],
  run(data, p) {
    const log = [];
    let qShares = 0, tShares = 0, cash = p.initial;
    let prevMonth = null, seeded = false;
    let monthly = p.monthly, contribYear = null, lastRebalYear = null;

    for (let i = p.startIdx; i <= p.endIdx; i++) {
      const qpx = data.qqq[i];
      const tpx = data.tqqq[i];
      const ym = data.dates[i].slice(0, 7);
      const year = data.dates[i].slice(0, 4);
      const monthNum = +ym.slice(5, 7);
      let contributed = 0, action = "hold";

      // grow the monthly contribution each calendar year
      if (contribYear === null) contribYear = year;
      else if (year !== contribYear) {
        if (p.annualRaise) monthly = monthly * (1 + p.annualRaise);
        contribYear = year;
      }

      // new-month cash injection
      if (prevMonth !== null && ym !== prevMonth && monthly > 0) {
        cash += monthly; contributed = monthly; action = "contribution";
      }
      prevMonth = ym;

      // seed the initial 50/50 split on the first tradable day
      if (!seeded && qpx > 0 && tpx > 0) {
        const half = cash / 2;
        qShares = half / qpx;
        tShares = half / tpx;
        cash = 0; seeded = true; action = "buy";
      }

      // deploy any fresh cash 50/50 into each
      if (seeded && cash > 0 && qpx > 0 && tpx > 0) {
        const half = cash / 2;
        qShares += half / qpx;
        tShares += half / tpx;
        cash = 0;
        if (action !== "contribution") action = "buy";
      }

      // yearly rebalance back to 50/50 (first trading day of the chosen month, once per calendar year)
      if (seeded && monthNum === p.rebalMonth && year !== lastRebalYear && qpx > 0 && tpx > 0) {
        const total = qShares * qpx + tShares * tpx + cash;
        const half = total / 2;
        qShares = half / qpx;
        tShares = half / tpx;
        cash = 0;
        lastRebalYear = year;
        action = "rebalance";
      }

      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== ym;
      const value = qShares * qpx + tShares * tpx + cash;
      if (contributed > 0 || action === "buy" || action === "sell" || action === "rebalance" || monthEnd) {
        log.push({
          date: data.dates[i],
          value: value,
          price: tpx,
          contributed: contributed,
          action: action,
          qqqVal: qShares * qpx,
          tqqqVal: tShares * tpx
        });
      }
    }
    return { log };
  }
}
