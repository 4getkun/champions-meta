# 日本語フォントの統一

英数はInter、日本語はHiragino Sans → Hiragino Kaku Gothic ProN → Zen Kaku Gothic New → Yu Gothic → Meiryoの順。
Macでは搭載書体を優先し、それ以外ではGoogle FontsのZen Kaku Gothic Newを同一ドメインから配信する。

- 日本語は400・500・700の3ウェイト。見出し700、本文400、補助ラベル500を中心に使う。
- 見出し・本文・数値の日本語書体を統一し、本文の行間と字間を調整。
- 配信からInter Tight・M PLUS 2・Noto Sans JPを除外。Interだけを先読みし、Mac向けに未使用の日本語フォントを先読みしない。
- font-display:swapを維持。Webフォントが読み込まれたら、Canvasの文字も同じ書体で再描画する。
- 静的TTFと可変TTFの両方をサブセット化できるようビルドを修正。使用文字とライセンス情報を確認し、OFL本文をfont-licensesへ同梱。

## 検証

Python66件、Node11件が成功。6画面×1440px／390pxと書体の13項目を確認し、JavaScript例外0件。
Windows実ロードは4ファイル・272,924B、変更前347,574Bから21.5%削減。
Mac実機での字形は未確認（CSSのヒラギノ優先順を検証）。

Lighthouse13.5・モバイルsimulate・cold cache・localhostで各3回の中央値：

| 指標 | 変更前 | 変更後 |
| --- | ---: | ---: |
| LCP | 9,027ms | 7,971ms |
| CLS | 0.83692 | 0.83680 |
| TBT | 189ms | 133ms |
| FCP | 2,256ms | 2,556ms |
| Performance | 46 | 47 |

ラボ計測であり実ユーザーのCore Web Vitalsではない。既存の動的読み込みによる大きなCLSは残り、今回の書体変更での改善対象にはしていない。
記録はdiagnostics/font-qa-baseline/とdiagnostics/font-qa-post/。
