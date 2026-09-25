# TASKS

## Done means（この世界用）
- `npm run dev` で起動し、キーボード＋マウスで歩く・走る・離陸・飛行・着陸・遊覧飛行ができる。VR ボタンから VR でも同じことができる。
- 10 地点 × 4 時刻の全カットで「場所らしさ」「テイスト」とも合格（docs/critic-iter-5.md）。
- 場所らしさトップ 10 のディテールアップ済み（docs/detail-top10.md）。
- `npm run explore`（8 項目）合格、`npm run typecheck` 合格、コンソールエラーゼロ。

## Phase 0 — ヒアリング
- [x] 乗り物（翼のある車・両方）/ 場所の画像（3 枚）/ テイスト（新海誠風）/ 秋 / 高田馬場 / PC VR / 背景に少し / 標準
- [x] refs/place/01〜03.jpg（refs/style は無し）
- [x] docs/brief.md をユーザーが確認

## Phase 1 — 調査と設定
- [x] docs/survey.md
- [x] src/config.ts
- [x] src/world/course.ts（早稲田通り・4 車線＋歩道・viewpoints 10）
- [x] palette.ts / timeofday.ts KEYS を新海調の秋に

## Phase 2 — Builder / Critic
- [x] iter-1（街・ガード・駅・路地・街区・飛行）
- [x] iter-2（路地の飲み屋、車、光だまり、グレア、朝）
- [x] iter-3（01 の構図、夕方のコントラスト、コックピット）
- [x] iter-4（いわし雲、路面、区画ごとの seed）
- [x] iter-5（トップ 10 ディテールアップ後の全カット）

## ディテールアップ（DETAIL.md）
- [x] トップ 10（docs/detail-top10.md）

## Phase 3 — VR と仕上げ
- [ ] VR 実機確認（ユーザー）
- [x] 性能（headless 1280×720 で 142 fps、draw calls 716）
- [x] README / CLAUDE.md 更新

---

# 残課題

## 要確認（実機）
- [ ] **VR 実機（PC VR）での確認**：酔い（飛行中の上下動・旋回・コックピットの傾き）、コントローラー割り当て、90 Hz を保てるか。
      未確認。`npm run dev` を PC の Chrome/Edge で開き ENTER VR。気になれば `xr.ts` の周辺減光の強さと `vehicle.ts` の flight.turn / climb を下げる。

## 場所らしさ
- [ ] 早稲田通りは西へ上り坂（実際）。`world.ts` の `terrainAt` に坂を入れ、道・歩道・建物の基礎を追従させる。
- [ ] さかえ通り（駅の東の商店街）と神田川は未実装。
- [ ] 上空から見える街区の道路に白線・車・街路樹が無い。
- [ ] 上空写真が無いまま既知の地理から起こしたので、建物の位置は写真と一致しない（01〜03 の構図は合わせた）。

## テイスト
- [ ] 雑居ビルの窓枠を実際に 3〜5 cm 出っ張らせる（今はテクスチャ）。2 m まで近づくと平板。
- [ ] 窓ガラスへの空の映り込み（昼の反射）。
- [ ] 夕方の逆光で建物の縁が光る（リムライト）。

## 乗り物
- [ ] 翼のある車の細部（ドアの継ぎ目・ミラー・ナンバー（架空）・ライトの光だまり）。
- [ ] 着陸できるのは道路（早稲田通り）の上だけ。広場や屋上にも降りたいなら `airSpan()` の onRoad 判定を広げる。

## 性能
- [ ] scene draw calls 約 700（影パス込み）。VR で重い場合は遠景の街区（380 m 以遠）の外壁を 1 材質のアトラスにまとめる、影の範囲を狭める。
- [ ] `stats().triangles` は post の quad の値を返している（calls は scene の値に直した）。
