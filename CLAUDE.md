# CLAUDE.md

アニメ背景風の 3D 探検テンプレート。three.js + Vite + TypeScript。依存は three のみ（dev に vite / typescript / playwright）。
**新しい世界を作る依頼なら、まず `PROMPT.md` に従う。** このファイルは構成・規約・罠・検証の運用メモ。

コード・コメント・コミットメッセージは英語、ユーザーへの返答はユーザーの言語で。

## Run

```bash
npm run dev        # http://127.0.0.1:5180  (HMR)
npm run dev:vr     # HTTPS + LAN 公開。ヘッドセットのブラウザから開く
npm run typecheck
npm run build
npm run shoot -- --out=iter-1   # 全 viewpoint x 4 時刻 + perf（dev server 起動中に）
npm run explore                 # 自動運転の回帰テスト（dev server 起動中に）
```
初回のみ `npx playwright install chromium`。

## 構成

```
src/
  config.ts            世界の設定（季節・緯度・移動手段・乗り物・人物）。URL でも上書き可 (?time=&season=&mobility=&vehicle=)
  main.ts              組み立て、ループ、入力、時刻→ライト反映、検証 API (window.__scene / __shot)
  core/util.ts         rng, strut(2点間の部材), box, textTexture(Canvas2D 看板)
  render/palette.ts    全ての色。季節で変わるものは seasonal()
  render/toon.ts       cel() / flat() / glow()。影の段を紫に色相シフトするパッチ、夜に光る素材の一括制御
  render/outline.ts    inverted hull。VR でも効く唯一の線
  render/post.ts       超解像ターゲット → 深度二階差分の墨線 + グレード。VR では丸ごと無効
  world/course.ts      ★道の中心線・道幅・viewpoints（場所ごとに書き換える）
  world/layout.ts      ★道沿いの配置（場所ごとに書き換える）
  world/kit.ts         部品: 家・店・電柱・電線・木・標識・自販機・ポスト・ガードレール・田んぼ
  world/world.ts       地形・道のリボン・heightAt・colliders・ctx・bake()
  world/road.ts        中心線クエリ（nearest, pointAt, yawAt, rightAt）
  world/timeofday.ts   緯度+季節+時刻→太陽。太陽高度でキーを補間（空・光・霧・影色・点灯・星）
  world/sky.ts         空ドーム(太陽・星)、積雲、遠景の山
  world/particles.ts   季節の粒子（花びら・蛍・落ち葉・雪）
  player/player.ts     徒歩/乗車、衝突、ガイドレール、カメラ、autopilot
  player/vehicle.ts    乗り物の表 (VEHICLES) と builder
  xr/xr.ts             WebXR: 着座・水平固定・スナップターン・周辺減光・手首時計・コントローラー
  ui/hud.ts            開始カード・時刻スライダー・ヒント・トースト
scripts/shoot.mjs      Critic 用撮影 (Playwright)
scripts/explore.mjs    回帰テスト (Playwright)
refs/place/ refs/style/   参考画像（git 管理外）
docs/                  brief.md / survey.md / critic-iter-N.md をここに
```

## 検証（見た目の変更の前後に必ず）

- **ブラウザのスクリーンショットに頼らない。** ブラウザペインは非表示だと rAF が止まり、`innerWidth` が 0 になることもある。
  代わりに `window.__shot()` / `__scene.grab()` が rAF 無しで 1 フレーム描いて返す：
  ```js
  await __shot('iter1/vp03-dusk', 1600, 900, { vp: '03', time: 18.4 })   // .shots/ に保存 → Read で見る
  await __shot('raw', 1600, 900, { vp: '03', ink: false, grade: false })  // パスを切って比較
  await __shot('free', 1600, 900, { pos: [x, 0, z], yaw, pitch })          // y=0 なら地面+目線
  ```
- 時間を進めるテストは手でステップ：`__scene.step(10)`（10 秒分）。
- `__scene.autoRun(120, 'ride' | 'walk')` → `{ progress, stuckSeconds }`。
- `__scene.bench()` → ms/frame, fps, draw calls。`__scene.stats()`。
- `__scene.keyTimes` は季節から計算した「朝・昼・夕方前・日没・夜」。

## 規約

- **フラットな XZ 平面で作る。** +x 東、−z 北、+y 上。地形は道沿い 38m は平ら（`terrainAt`）。
- **部品は +Z 向きで原点に作り、`place()` で置く。** 軸で分岐しない。道に向けるのは layout.ts の `face()`。
- **部材は `strut(a, b)` で 2 点間に張る。** 中心＋角度で置くと端が合わない。回転後の位置は `applyEuler` で出す。
  傾きの符号：Z 方向の箱を X 軸で +t 回すと +z 端は**下がる**（kit.ts の屋根はこれを解いている）。
- **静的な物は `ctx.add()`**（最後にマテリアル毎にマージ＝draw call 削減）。動く物・光る物・線付きの主役は `ctx.addDynamic()`。
- **色は palette.ts、素材は `M(color)`（共有）**。共有しないとマージされない。
- 衝突は `ctx.collide()` / `ctx.collideObject()`。**曲がった長い物に 1 つの AABB を張らない**（道ごと塞ぐ）。短く刻む。
- 歩ける高さは `ctx.platform()`。隣り合う platform は**重ねる**（接するだけだと落ちる）。
- 看板は `textTexture()`。**キャンバスの縦横比を貼る面に合わせる**。両面看板に鏡像 UV を使わない。
- 夜に光る物は `glow(base, light)`。時刻が一括で強さを決める。

## 既知の罠

| 症状 | 原因 |
|---|---|
| 墨線が全く出ない（エラーなし） | MSAA のレンダーターゲットは深度テクスチャに resolve されない。post.ts は超解像（scale 1.5）で回避している。samples を戻さないこと |
| ShaderMaterial で `Cannot read properties of undefined (reading 'value')` in refreshFogUniforms | `fog: true` なのに fog uniforms が無い。`UniformsLib.fog` を混ぜる |
| 空に暗い丸が浮く | 樹冠が `receiveShadow`。樹冠は影を**落とすだけ** |
| 細い物が真っ黒な串になる | 極細ジオメトリの flat shading。`flatShading` を使わない |
| 薄い物・透明物の周りに線のノイズ | `depthWrite` している。透明物は cel() が自動で切る |
| 回転させた部品が世界の原点周りを回る | マージ済み（bake 済み）のメッシュを動かした。動く物は `addDynamic` |
| 看板が判読不能な滲み | テクスチャと面の縦横比が違う |
| VR で酔う | 頭に傾き・ピッチを渡している。xr.ts は rig を yaw だけ回す。乗り物の lean は body だけ |
| VR で線が消える | 仕様（post 無効）。必要な物に `addOutline()` |
| 時間変化がカクつく/GC | 毎フレーム new している。timeofday.ts はスクラッチの Color を使う |
| 夜が真っ暗/昼が白飛び | `KEYS` の sunI / hemiI / fogFar。まず 4 時刻を撮って並べる |

## 見つけた罠はここに追記していく
