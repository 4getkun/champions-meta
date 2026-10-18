# グラフとアイコンの仕上げ

- 推移グラフに、最新値のピル、ポケモン画像・名前・最新値を含むHTML凡例を配置。ボタンで系列を消して再表示でき、キーボードにも対応。
- グラデーションは、同じレギュレーションに連続する観測値がある1系列だけを強調。単月のデータを面で連続しているように見せない。
- 月の目盛りを短くし、レギュレーション帯、ホバーの縦線、最新点のリングで読む位置を明確にする。
- 使用率6匹・順位10匹を同じグラフで表示。順位の11位以下はグラフの「圏外」に収め、ツールチップと表には実順位を残す。
- 追加ライブラリなし。読み込みアニメーションを使わず、resizeDelay=0と破棄処理を維持。
- faviconはモンスターボールを参考に手描きSVGで制作。赤・白・濃紺と中心の青で構成し、ICO（16/32px）とApple用PNG（180px）をSVGから生成。ヘッダーも同じ図案に統一。
- 工房側のOG原画像とサムネイルは別管理のため、採用A案と対象の縮小画像を工房リポジトリでも更新。

参照した現行の公式資料・デザイン研究：

- [Chart.js HTML Legend](https://www.chartjs.org/docs/latest/samples/legend/html.html)
- [Chart.js Linear Gradient](https://www.chartjs.org/docs/latest/samples/advanced/linear-gradient.html)
- [Chart.js Axis Styling](https://www.chartjs.org/docs/latest/axes/styling.html)
- [Observable Plot Text mark](https://observablehq.github.io/plot/marks/text)
- [Tableau Research: From a Dashboard Zoo to Census](https://www.tableau.com/blog/tableau-research-understanding-dashboard-design-at-scale)
