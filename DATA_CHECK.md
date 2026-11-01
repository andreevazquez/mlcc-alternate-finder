# Data verification checklist

The page claims the specs below for each catalog part. They follow each manufacturer’s part-numbering scheme but have not been checked against datasheets.

How to use this list:

1. Open the manufacturer’s datasheet or product page for the part number.
2. Compare every spec in the row. If all match, set **Verified** to **Y** and paste the datasheet URL.
3. If anything differs, leave **Verified** at **N**, note the difference and the source, and correct `rules.js` (and the tests, if affected) only from that source.

Stock and lead times are simulated and aren’t listed here. Grade means the part is in an AEC-Q200 automotive series (Automotive) or not (Commercial).

| # | Part number | Manufacturer | Capacitance | Voltage | Case | Dielectric | Tolerance | Grade | Verified (Y/N) | Datasheet URL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `GRM188R71H104KA93D` | Murata | 0.1 µF | 50 V | 0603 | X7R | ±10% | Commercial | N | |
| 2 | `C1608X7R1H104K080AA` | TDK | 0.1 µF | 50 V | 0603 | X7R | ±10% | Commercial | N | |
| 3 | `CL10B104KB8NNNC` | Samsung | 0.1 µF | 50 V | 0603 | X7R | ±10% | Commercial | N | |
| 4 | `CC0603KRX7R9BB104` | Yageo | 0.1 µF | 50 V | 0603 | X7R | ±10% | Commercial | N | |
| 5 | `C0603C104K5RACTU` | KEMET | 0.1 µF | 50 V | 0603 | X7R | ±10% | Commercial | N | |
| 6 | `06035C104KAT2A` | KYOCERA AVX | 0.1 µF | 50 V | 0603 | X7R | ±10% | Commercial | N | |
| 7 | `GCM188R71H104KA57D` | Murata | 0.1 µF | 50 V | 0603 | X7R | ±10% | Automotive (AEC-Q200) | N | |
| 8 | `CGA3E2X7R1H104K080AA` | TDK | 0.1 µF | 50 V | 0603 | X7R | ±10% | Automotive (AEC-Q200) | N | |
| 9 | `GRM188R72A104KA35D` | Murata | 0.1 µF | 100 V | 0603 | X7R | ±10% | Commercial | N | |
| 10 | `CL10F104ZB8NNNC` | Samsung | 0.1 µF | 50 V | 0603 | Y5V | +80/−20% | Commercial | N | |
| 11 | `GRM155R71C104KA88D` | Murata | 0.1 µF | 16 V | 0402 | X7R | ±10% | Commercial | N | |
| 12 | `CL21B104KBCNNNC` | Samsung | 0.1 µF | 50 V | 0805 | X7R | ±10% | Commercial | N | |
| 13 | `C1608X7R1E104K080AA` | TDK | 0.1 µF | 25 V | 0603 | X7R | ±10% | Commercial | N | |
| 14 | `GRM21BR61A106KE19L` | Murata | 10 µF | 10 V | 0805 | X5R | ±10% | Commercial | N | |
| 15 | `C2012X5R1A106K125AB` | TDK | 10 µF | 10 V | 0805 | X5R | ±10% | Commercial | N | |
| 16 | `CL21A106KAYNNNE` | Samsung | 10 µF | 25 V | 0805 | X5R | ±10% | Commercial | N | |
| 17 | `CC0805KKX5R6BB106` | Yageo | 10 µF | 10 V | 0805 | X5R | ±10% | Commercial | N | |
| 18 | `GRM21BR61E106KA73L` | Murata | 10 µF | 25 V | 0805 | X5R | ±10% | Commercial | N | |
| 19 | `CL21B106KOQNNNE` | Samsung | 10 µF | 16 V | 0805 | X7R | ±10% | Commercial | N | |
| 20 | `GRM188R61A106KE69D` | Murata | 10 µF | 10 V | 0603 | X5R | ±20% | Commercial | N | |
| 21 | `GRM155R61A105KE15D` | Murata | 1 µF | 10 V | 0402 | X5R | ±10% | Commercial | N | |
| 22 | `C1005X5R1A105K050BB` | TDK | 1 µF | 10 V | 0402 | X5R | ±10% | Commercial | N | |
| 23 | `CL05A105KA5NQNC` | Samsung | 1 µF | 25 V | 0402 | X5R | ±10% | Commercial | N | |
| 24 | `CC0402KRX5R6BB105` | Yageo | 1 µF | 10 V | 0402 | X5R | ±10% | Commercial | N | |
| 25 | `GRM1885C1H101JA01D` | Murata | 100 pF | 50 V | 0603 | C0G | ±5% | Commercial | N | |
| 26 | `C1608C0G1H101J080AA` | TDK | 100 pF | 50 V | 0603 | C0G | ±5% | Commercial | N | |
| 27 | `C0603C101J5GACTU` | KEMET | 100 pF | 50 V | 0603 | C0G | ±5% | Commercial | N | |
| 28 | `CC0603JRNPO9BN101` | Yageo | 100 pF | 50 V | 0603 | C0G | ±5% | Commercial | N | |
| 29 | `GCM1885C1H101JA16D` | Murata | 100 pF | 50 V | 0603 | C0G | ±5% | Automotive (AEC-Q200) | N | |
| 30 | `CL10B101KB8NNNC` | Samsung | 100 pF | 50 V | 0603 | X7R | ±10% | Commercial | N | |
