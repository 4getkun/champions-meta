# 日本語フォントと文字の描画

## 現在の方針

英数はInter、日本語はHiragino Sans → Hiragino Kaku Gothic ProN → Noto Sans JP → Yu Gothic → Meiryoの順。
Macの搭載書体を優先し、WindowsなどではGoogle Fonts由来のNoto Sans JPを同一ドメインから配信する。

- Zen Kaku Gothic New、Noto Sans JP、BIZ UDPGothicを同じ14px本文・12px補助文字で比較。今回の小さな統計UIではNoto Sans JPを採用。
- 文字サイズと行高は維持。本文は400から450、補助文字は500、見出しは700を中心に使う。本文の字間は標準へ戻す。
- 日本語は400〜700の可変ウェイト1ファイル。英数はInterの可変ウェイト1ファイル。不要な疑似太字・疑似斜体を抑えるためfont-synthesis:none。
- text-renderingはauto。独自のfont-smoothing指定を削除し、OSとブラウザーの標準描画に任せる。
- font-display:swapを維持。Mac向けの未使用日本語フォントの先読みを避け、Interだけを先読みする。
- 共有PNGも同じ日本語書体を採用し、フォント読み込み完了後に生成する。
- フォントはサイトの使用文字でサブセット化し、ライセンスと著作権表示を残す。OFL本文はsite/font-licensesに同梱。

## 診断の範囲

変更前の本番をWindows Chrome、1440×1000、DPR1、ブラウザーズーム1で測定。
CSS.getPlatformFontsForNodeで日本語はZen Kaku Gothic New、英数はInterの実描画を確認した。
対象文字と祖先にtransform・filter・zoomによるぼけの根拠は見つからなかった。
ユーザー端末のDPI設定、ClearType、ブラウザーズームは取得できておらず、スクリーンショットだけから原因は断定しない。

比較: diagnostics/font-render-compare.html と font-render-compare.jpg。
診断: diagnostics/font-render-baseline.json。
読み込み測定はLighthouseのモバイルsimulate・cold cache・localhostで変更前後各3回を比較する。ラボ測定は実ユーザーのCore Web Vitalsではない。

## 読み込みのラボ計測

変更前後各3回の中央値（mobile simulate、cold cache、localhost）：

| 指標 | 変更前 | 変更後 |
| --- | ---: | ---: |
| LCP | 9204.826 | 8795.482 |
| FCP | 2253.419 | 2255.293 |
| TBT | 35 | 57 |
| CLS | 1.081 | 1.081 |
| score | 0.48 | 0.48 |

この計測では既存の動的表示による大きなCLSが残っている。書体の変更だけでサイト全体の表示安定性が解決したとは扱わない。
LighthouseはJSONレポートの計測完了後にWindowsの一時プロファイル削除でEPERMを報告したが、6レポートともruntimeErrorなし・指標取得済み。再帰削除の代替操作は行っていない。

## 表示と描画の確認

Python68件、Node13件が成功。6画面×1440px／390px×明暗の24条件で、表示・横はみ出しの48検査を確認。JavaScript例外・console.errorは0件。
Noto Sans JPの400・450・500・600・700について、日本語8グリフの実描画をCSS.getPlatformFontsForNodeで確認。共有PNGも同書体で生成。
フォント要求は4件から2件、配信ファイルは合計約274KBから約199KB。Mac実機での描画は未確認。
記録はdiagnostics/font-render-post-report.json、計測値はfont-render-performance.json。
