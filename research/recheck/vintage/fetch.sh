#!/bin/zsh
# Real-time NFCI: for each vintage date, the last three readings as published then (ALFRED).
for v in 2011-08-17 2011-08-24 2011-09-28 2011-10-05 2011-10-12 2011-11-30 2011-12-21 2012-06-13 2015-08-26 2015-12-30 2016-02-10 2016-02-17 2018-12-27 2019-01-09 2020-03-11 2020-03-18 2020-03-25 2020-04-01 2020-04-08 2020-04-15 2020-04-22 2020-04-29 2020-05-06 2020-05-13 2022-06-22 2022-10-05 2022-10-12 2022-10-19 2023-03-22 2023-03-29 2023-04-05 2024-08-07 2025-04-09 2025-04-16 2025-04-23; do
  out=$(curl -sS --max-time 45 "https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=NFCI&vintage_date=$v&cosd=2010-01-01&coed=$v" 2>&1)
  echo "$v | max since 2010 in this vintage: $(echo "$out" | tail -n +2 | awk -F, 'BEGIN{m=-9}{if($2+0>m){m=$2+0;d=$1}}END{print m" ("d")"}') | last: $(echo "$out" | tail -2 | tr '\n' ' ')"
done
