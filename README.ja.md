![hopper-plugin banner](docs/assets/banner.png)

# hopper-plugin

> Vendor-neutral background dispatch for AI agents

![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-0.49.0-3DDC97)
![Tests](https://img.shields.io/badge/tests-passing-3DDC97)
![Hosts](https://img.shields.io/badge/hosts-7-111827)

> 言語リンク：🇨🇳 [中文](README.md)（デフォルト）・🇬🇧 [English](README.en.md)

## これは何か

複数の vendor CLI はそれぞれ独自のアカウント、認証方式、サンドボックス挙動、出力形式を
持っている——コマンドラインを直接手で組むと、バックグラウンドタスクを1つ走らせるたびに
「終わったか」「出力はどこか」「失敗したら人間が見るべきか」を自分で管理することになり、
しかも**ホストをまたいで使い回せない**。

hopper-plugin は llm-hopper のファイルプロトコルの上に乗る薄いプラグインである。Claude
Code、Codex CLI、OpenCode、Copilot CLI、Grok Build、Cursor CLI、あるいは standalone
shell(計7種のホスト)から、タスク種別化された作業を codex、kimi、opencode、copilot、
agy、grok、mimo、claude といった vendor CLI へ派遣できる。状態はすべて `.hopper/` 配下の
markdown と JSONL ファイルに落ちる——**隠れたデータベースはなく、harness の反応核も存在
せず、vendor の自動リトライや自動フォールバックもない**。

**製品として実際にサポートしている vendor は4社のみ:`codex` / `grok` / `claude` /
`kimi`**(2026-07-31 の製品判断)。残る4つの adapter(`agy` / `copilot` / `mimo` /
`opencode`)は依然としてコードに登録されており、`--vendors` を叩けば8社すべてが列挙
されるが、現在推奨されている利用範囲には含まれていない——具体的な階層と実行判定の場所は
下記の「vendor 制御の2層」と「ホストと vendor サポートマトリクス」を参照。

![hopper-plugin architecture](docs/assets/architecture.svg)

7種のホストからの呼び出しはすべて `hopper-dispatch` に収束する。ディスパッチャは
`.hopper/queue.md` と `.hopper/AGENTS.md` を読み、vendor を解決し、**同族隔離**を1つ
強制する——判定基準は `VENDOR_FAMILY`「ファミリー」比較(`cli/src/validation.js`)で、
`claude` / `claude-code` → anthropic、`codex` → openai、`grok` → xai、`kimi` →
moonshot、`copilot` / `opencode` / `mimo` / `agy` はマルチバックエンドのルーターで
あるため意図的にファミリー分けされていない。ファミリーが同じであれば派遣を拒否し、あるホスト
が自分自身と同じアカウント体系にタスクを転送してしまうのを防ぐ。バックグラウンドタスクは
`hopper-runner` によって起動され、dashboard は同じ `.hopper/` 状態を読み取るだけの
read-only な消費者である。

## いつ使うか / いつ使わないか

**Hopper が責任を持つのは「結果」であって「過程」ではありません。** spawn は一度きり、
リトライもフォールバックもなく、vendor は自分のコンテキストを持たない別プロセスで動く
ため途中で軌道修正できません。追加の問いかけは新しい dispatch になります。

dispatch の前に2つ確認し、どちらか通らなければホスト側で処理してください。

1. **正解を自分で算出できるか。** できるなら自分でやる。ソースの要約、コミット履歴、
   ファイル検索、バージョン確認は答えが一意に決まる問い合わせであり、dispatch は数分と
   数ドルを払って**より信頼性の低い**答えを返します。（実測：ある review dispatch は
   5分16秒 / 153万トークン / $0.74。比較対象の `git log` は 40ms。）
2. **問い全体を今この場で書き切れるか。** 書けないなら探索的な作業であり、探索に必要な
   軌道修正は単発 spawn の dispatch では提供できません。

両方通ったら、決め手は**独立性に価値があるか**です。自分のコンテキスト・先入観・誤りを
共有しない答えが欲しいのかどうか。

判断基準は主題ではなく**成果物**です。コードレビューはソースを読み**ます**が、それは
手段であり、成果物は判断なので dispatch すべきです。「このモジュールの説明」も
ソースを読みますが、返るのは自分で作れるデータなので dispatch すべきではありません。

**「使わない」側に対応する task-type は存在せず、その不在こそが実行面の制約です。**
brief の意図を推測する仕組みは要りません。詳細は
[`docs/WHEN-TO-USE.md`](docs/WHEN-TO-USE.md)、
`hopper-dispatch --task-types` も型ごとに同じ「用途/非用途」を表示します。

## vendor 制御の2層

1回の dispatch が発行できるかどうかは、独立した2層の関門を通過する必要がある——両方を
通過して初めて成立する:

**下層:このマシンに何がインストールされ、認証されているか。** `hopper-dispatch --setup`
(doctor)はこのマシンにインストール済み・認証済みの vendor CLI をスキャンし、
Installed / Auth / Sandbox / WebSrch / Models などを報告する(`/hopper:setup`)。これは
能力レイヤーであり、「このマシンでこの vendor が使えるか」に答える。

**上層:このプロジェクトが誰へのタスク派遣を承認しているか。** `.hopper/AGENTS.md` の
`## Approved Vendors` 表が、**このプロジェクト**がどの vendor への dispatch を許可
しているかを決める。**fail-closed**:このセクションが欠けている場合、あるいはある
vendor が表に無い / 状態が `yes` でない場合は、一律に派遣を拒否する——**明示的な
`--vendor` オーバーライドを含めて**。エラーコードはそれぞれ
`E_APPROVED_VENDORS_SECTION_MISSING`(セクション全体が欠落)と
`E_VENDOR_NOT_APPROVED`(セクションはあるがその vendor が承認されていない)。

これは v0.40.0 で新たに追加されたプロジェクトレベルのホワイトリストである。それ以前は、
`Notes` 列の「対象/対象外」という注記は単なる文言上の説明にすぎず、コードはそれを一度も
読んでいなかった——`--vendor` に登録済みの vendor を渡せば、プロジェクトが実際に承認して
いるかどうかとは無関係に派遣できてしまっていた。

この2層は現時点では**互いを参照しない**:`hopper-dispatch --setup` のレポートには
Approved Vendors の状態が表示されないし、`commands/setup.md` と
`skills/hopper-setup/SKILL.md` の2つのドキュメントには「Approved」という単語すら
一度も出てこない。Approved Vendors 表の側にも、このマシンに何がインストールされて
いるかは表示されない。下層は「使えるか」に答え、上層は「許されているか」に答える——
読んでいるのは別々の2つのファイルである。

## できないこと / セキュリティ境界の実際

このセクションは免責事項ではない。以下の各項目は、この README の信頼性を誇張の上に
築かないためにある。

- `read-only` はタスク種別が携える**リクエスト**であって、保証ではない——それは
  executor prompt frame によって伝達されるものであり、それが本当の OS レベルの境界に
  なるかどうかは**vendor とプラットフォームに依存する**。
- **grok は常に `bypassPermissions`**であり、プラットフォームとは無関係
  (`cli/src/vendors/grok.js`、ファイル全体を見てもプラットフォーム分岐は一切ない)。
- **codex はプラットフォームによって分岐する**:macOS / Linux では、codex 自身の
  `-s <mode>` サンドボックスは本物である——書き込み操作は実際に失敗し、
  `operation not permitted` が返る。**Windows では codex の `-s` サンドボックスは
  そもそも子プロセスを起動できない**ため、要求されたモードが何であれ常に
  `--dangerously-bypass-approvals-and-sandbox` で全開放になる。
  `HOPPER_CODEX_SANDBOX_BYPASS` は**プラットフォームによって極性が逆になる**:
  Windows では `=0` が bypass を無効化し、macOS / Linux では `=1` が bypass を有効化
  する——両プラットフォームでデフォルト値がもともと逆であり、この変数はそれぞれに
  対して1つのスイッチを与えているにすぎない。
- 上記の「vendor 制御の2層」とは別に、もう1つ独立した**同族隔離**ガードが存在する
  (旧ドキュメントと `--help` はこれを `host != vendor` と表記しているが、**その表記
  自体に誤解を招く点がある**:文字どおりに読めば `'claude-code'` と `'claude'` は
  決して等しくならず、「このガードは恒に成立する=無いのと同じ」という逆の結論に
  たどり着いてしまう。しかしそれこそがこのガードが本来阻止すべき組み合わせなのである)。
  Claude Code 下では**約2か月間、実質的に機能していなかった**(2026-06-03 導入とされる
  ~ 2026-07-31 修正、v0.39.0 を参照):`HOPPER_HOST_VENDOR` という環境変数は、5つの
  Tier-C bash ホスト wrapper だけが設定するものであり、Claude Code のセッション内では
  一度も設定されたことがなかった。ガード自身の「hostVendor が無ければスキップする」
  という分岐が、チェックそのものを静かに握りつぶしていた。仮にこの値を補ったとしても、
  当時の判定基準は素の文字列比較のままであり、`'claude-code' === 'claude'` は永遠に
  false であるため、本来阻止すべきケースには追いつけなかった。v0.39.0 から
  `VENDOR_FAMILY` によるファミリー比較に変更され、**今になってようやく実際に機能する
  ようになった**——これを「このガードはずっと有効だった」と読んではならない。
- 自動リトライしない、自動で vendor を切り替えない、フォールバックもしない——1回の
  spawn は1回の spawn でしかない。
- **Windows では vendor プローブキャッシュが利用できない。** このキャッシュはプローブ
  診断情報を含むため、書き込み前にディレクトリとファイルを owner-only に固める必要が
  ある。POSIX では `0700`/`0600` であり、実際に成立する。Windows では成立しない——
  GitHub Actions `windows-latest` での実測(2026-08-03)では、固めた後も
  `NT AUTHORITY\SYSTEM` と `BUILTIN\Administrators` がフルコントロールを保持しており、
  そもそも Administrators はいつでも所有権を奪える。**hopper は fail-closed を選ぶ**:
  owner-only を確立できなければ、「その主体は数えない」とアサーションを緩めるのではなく、
  **キャッシュ書き込みを拒否する**。代償として、Windows では vendor 能力を毎回
  プローブし直すことになり、キャッシュは再利用されない。この制限は以前から存在して
  いたが**一度も効いていなかった**——固める処理は実際には何もしておらず、
  アサーション自体が実行されたことがなかった。本リポジトリに初めて CI を入れたことで
  表面化した。
- 権威ある情報源は `hopper-dispatch --rules`(`.hopper/DISPATCH.md` に書き出される)
  である。**この README 内の表や記述はすべてスナップショットであり、乖離しうる**——
  実際に判断を下す前には、`--rules` をその場で実行した結果を正とすること。

## クイックスタート

新しいプロジェクト / 新しい agent が初めて接続する際の完全な流れは以下のとおりで、
途中のどのステップを飛ばしても次のステップで壁にぶつかる:

```bash
# 0. プラグインを入れたら、まずこのマシンにどの vendor CLI があるか、
#    インストール済みか、認証済みかを確認する(doctor)
hopper-dispatch --setup

# 1. プロジェクト内に .hopper/ ワークスペースを作る——queue.md / AGENTS.md /
#    COST-LOG.md / DISPATCH.md / handoffs/leader-tasklist.md に加え、
#    8個の tasks/*.md タスク種別テンプレート、計13ファイル
hopper-dispatch --init-tasks

# 2. .hopper/AGENTS.md を開き、使いたい vendor を `## Approved Vendors` 表に
#    記入して yes を付ける——このステップを行わないと、以降の dispatch は
#    すべて fail-closed で拒否される。上記「vendor 制御の2層」を参照

# 3. .hopper/queue.md にタスクを1行書き、派遣する
hopper-dispatch T-PROG-AUDIT --background

# 進捗確認 / 結果取得
hopper-dispatch --progress T-PROG-AUDIT
hopper-dispatch --result   T-PROG-AUDIT
```

Claude Code では等価な slash command を使う:

```text
/hopper:dispatch T-PROG-AUDIT --background
```

## モデルと推論レベルの選択

`--model` と `--reasoning` は**2つの独立したつまみ**である——同じ文字列に連結しては
ならない。`gpt-5.5-xhigh` は誤りである:これはモデル名(`gpt-5.5`)と推論レベル
(`xhigh`)を貼り合わせたものであり、vendor はそれを未知のモデルとして拒否する。
別々に設定すべきである:

あるモデル名が本当に存在するか確信が持てず、それを確かめるために dispatch を1回無駄に
したくない場合——`--check-model` は spawn ゼロのアサーションである:
`hopper-dispatch --check-model codex gpt-5.5-xhigh` は上記のような連結ミスを名前
だけで識別できる(専用の `effort-spliced` 判定、exit 1)。vendor 側で 400 として
弾かれてから気づく必要はない。

```bash
# reasoning だけを設定——model はアカウントのデフォルト値を使う
hopper-dispatch T-PROG-AUDIT --background --reasoning xhigh

# model と reasoning の両方を設定、両者は独立している
hopper-dispatch T-PROG-AUDIT --background --model gpt-5.4-mini --reasoning high

hopper-dispatch --progress T-PROG-AUDIT
hopper-dispatch --result   T-PROG-AUDIT

# Claude Code での等価な flag:
# /hopper:dispatch T-PROG-AUDIT --model gpt-5.4-mini --reasoning high
```

- `--model <name>` —— vendor 自身の model id。**省略した場合はアカウントのデフォルト
  値を使う。**
- `--reasoning <minimal|low|medium|high|xhigh>` —— 推論強度。**デフォルトは
  `xhigh`**;グローバルなデフォルト値は `HOPPER_DEFAULT_REASONING` で変更できる。

すべての CLI がこの2つのつまみを同時に公開しているわけではない。各 vendor が実際に
サポートしている状況は以下のとおり:

| vendor | `--model` | 推論レベル(`--reasoning`) | 備考 |
|---|---|---|---|
| codex | `-m` | ✓ | **裸の名前のみ受け付ける**:`gpt-5.5`、`gpt-5.4-mini`、`gpt-5.3-codex-spark`。provider プレフィックス付きの id(`openai-codex/…`)は ChatGPT アカウントでは拒否される。 |
| grok | `-m` | ✓ | low/med/high の列挙値;`xhigh` は `high` に clamp される。 |
| mimo | `--model` | ✓ | `xhigh` → `--variant max`。**製品サポート範囲外**(2026-07-31 決定)——後述。 |
| copilot | `--model` | ✓ | low/med/high の列挙値;`xhigh` は `high` に clamp される。生の上書き値:`HOPPER_COPILOT_EFFORT`。**製品サポート範囲外**(2026-07-31 決定)——後述。 |
| opencode | `--model <provider/model>` | 明示的に渡した場合のみ有効 | 呼び出し側が渡した `--reasoning high` は `--variant high` に変換される;Hopper は provider 互換性を保つため、意図的に OpenCode へデフォルトの `xhigh` を送らない。`HOPPER_OPENCODE_VARIANT=<v>` でそのまま上書きできる。**製品サポート範囲外**(2026-07-31 決定)——後述。 |
| kimi | `-m` | — | `kimi -p` には呼び出しごとの effort flag が無い。 |
| claude | `--model` | — | `claude -p` には effort flag が無い。 |
| agy | — | — | ⚠️ **デフォルトで技術的に無効化**されており、かつ**製品サポート範囲外**(2026-07-31 決定)——後述。 |

上の表はスナップショットである。**権威があり、乖離しない**バージョンは adapter から
その場で生成されたものである——このマシン / このアカウントのリアルタイムの実態を
調べるには次を使う:

```bash
hopper-dispatch --rules                 # 完全なマトリクス(同時に .hopper/DISPATCH.md にも書き出される)
hopper-dispatch --capabilities codex    # 単一 vendor の model/effort/perms 契約
hopper-dispatch --probe codex           # このアカウントのリアルタイムの model カタログ
hopper-dispatch --check-model codex gpt-5.5   # 派遣前にモデルをアサート:verified(0) | catalog-only(2) | not-found(1)
```

環境変数によるチューニング:

| 変数 | 効果 |
|---|---|
| `HOPPER_DEFAULT_REASONING` | グローバルな effort のデフォルト値(未設定時は `xhigh`)。 |
| `HOPPER_COPILOT_EFFORT` | 生の copilot `--effort` 値(例:`max`);`""` はこの flag を渡さないことを意味する。 |
| `HOPPER_OPENCODE_VARIANT` | 最優先される生の OpenCode `--variant` 上書き値;provider/model によって妥当性が検証される。 |
| `HOPPER_GROK_EFFORT` | 生の grok `--effort` 値;`""` はこの flag を渡さないことを意味する。 |

OpenCode に対しては、選択した provider/model のドキュメントが特定の variant を明確に
サポートしている場合にのみ指定すべきである:

```bash
# OpenCode が実際に受け取るもの: opencode run ... --variant high
hopper-dispatch T-PROG-AUDIT --background --vendor opencode --reasoning high
```

`--reasoning` を省略した場合、Hopper は他の adapter に対しては汎用的な有効デフォルト値を
保持するが、OpenCode に対しては意図的に `--variant` を一切送らない;tokenbox /
DeepSeek のようなカスタム provider には、Hopper が検証済みの variant 契約が存在しない。

派遣権限のデフォルトは `danger-full-access` であり、実装系タスクがファイルを変更できる
ようにするためである。タスクの brief / spec に `read-only` / 只読 と書かれている場合、
hopper は自動的に vendor サンドボックスを `read-only` に降格させる;
`--sandbox <read-only|workspace-write|danger-full-access>` で上書き可能。この降格は
あくまで1つの**リクエスト**であり、それが本当の OS レベルの境界になるかどうかは
vendor とプラットフォームに依存する——完全で正直なバージョンは上記「できないこと /
セキュリティ境界の実際」のセクションを参照。

## バックグラウンド派遣と観測

```bash
hopper-dispatch T-PROG-REVIEW --background
npm run dashboard:build
npm run dashboard:start
# http://127.0.0.1:7777 を開き、該当タスクの Progress タブを選ぶ
```

![hopper-plugin background dispatch data flow](docs/assets/data-flow.svg)

1回のバックグラウンド dispatch は `output.md`、`output.log`、`progress.log` を書き
出す。runner は実行過程を通じて progress JSONL イベントを追記し続け、vendor が終了する
際に**ちょうど1件**の終端イベントを追記する。`--progress`、`--watch-events`、Claude の
monitor、システムの toast、そして dashboard の SSE は、すべて同じこのファイル状態を
読んでいる。

Claude Code ユーザーはプラグインの monitor を通じても終端イベントを受け取れる。
Standalone と Codex CLI のユーザーは watcher を常駐させておくことができる:

```bash
hopper-dispatch --watch-events
```

**ホスト間の等価性**:同じタスク ID であれば、どのホストから発行しても、解決に
使われるのは同じ `.hopper/` ルーティングテーブルである:

```bash
hopper-dispatch --resolve T-PROG-REVIEW
# Claude Code: /hopper:dispatch T-PROG-REVIEW --background
hopper-codex T-PROG-REVIEW --background
hopper-opencode T-PROG-REVIEW --background
```

## コマンドと skills

| コマンド | 内容 |
|---|---|
| `/hopper:dispatch` | タスクをその優先 vendor へ派遣する(`--vendor` でルーティングを上書き;`--result <id> --full` で完全な長い出力を見る)。 |
| `/hopper:review` | diff/path/PR に対する1回限りの読み取り専用\*コードレビュー(一時タスク、queue.md には入らない)。 |
| `/hopper:research` | Web検索付きの、1回限りの製品/機能リサーチ(一時タスク、読み取り専用\*)。 |
| `/hopper:market` | Web検索付きの、1回限りの市場/競合リサーチ(一時タスク、読み取り専用\*)。 |
| `/hopper:swarm` | 定性的なタスクを N 社の vendor からなるレビューパネルへ分配する(確認 → 並列実行 → 統合)。 |
| `/hopper:setup` | vendor の準備状況:インストール済みか、認証済みか、モデル、サンドボックス、Web検索能力。 |
| `/hopper:status` | キューのサマリーを表示する。 |
| `/hopper:result` | 完了済みタスクの結論とログの末尾を取得する(`--full` で完全なテキストを見る)。 |
| `/hopper:models` | キャッシュ済みの vendor モデルを一覧表示する。 |
| `/hopper:probe` | vendor 能力キャッシュを更新する。 |
| `/hopper:vendors` | 登録済みの vendor adapter を一覧表示する。 |
| `/hopper:smoke` | インストールのセルフチェックを実行する。 |
| `hopper-watch-events` | 終端イベントを配信する Claude monitor。 |

\* 「読み取り専用」はタスク種別が**リクエスト**するサンドボックスであり——executor
prompt frame が携える1つの指示にすぎない。それが本当に強制されるかどうかは vendor、
そして(codex の場合は)プラットフォームに依存する。**grok** はどんなリクエストであれ
全開放で動作する;**codex** も Windows 上では同様だが、macOS/Linux では実際に
読み取り専用サンドボックスを実行する(完全な内容は上記「できないこと」のセクションを
参照)。このマシンでの具体的な挙動は `/hopper:review` と `hopper-dispatch --rules`
で確認すること。

## ホストと vendor サポートマトリクス

**7種のホスト**すべてが dispatch を開始できる:Claude Code、Codex CLI、OpenCode、
Copilot CLI、Grok Build、Cursor CLI、そして standalone shell。

**8個の vendor adapter** が登録されているが、製品として実際に推奨されているのは
そのうち4個だけである:

> **製品としてサポートされている vendor の集合(2026-07-31 決定):`codex` / `grok` /
> `claude` / `kimi`。**
> `agy` / `copilot` / `mimo` / `opencode` は**サポート範囲に含まれない**——これは
> 積極的にメンテナンスする利用範囲を絞り込む製品判断であり、コードレベルの制限では
> ない。それらの adapter ファイルは**削除されていない**(削除すると既存のテストや
> 履歴記録が壊れる);依然として登録されたままであり、`--vendors` は今も8社すべてを
> 列挙し、コード中のどこにも「この4社しか認めない」というハードコードは存在しない
> (そうしてしまうと本当の実行判定ポイントと重複し、食い違いを起こしかねない)。
> ある**具体的なプロジェクト**が誰に派遣できるかの実行判定ポイントは、そのプロジェクトの
> `.hopper/AGENTS.md` にある **`Approved Vendors`** 表である——fail-closed:この
> セクションが欠けている場合、あるいはある vendor が表に無い / `yes` でない場合は、
> **明示的な `--vendor` オーバーライドを含めて**一律に派遣を拒否する。
>
> **agy にはさらにもう1つ、純粋に技術的な無効化がある(2026-06-26)。** agy 1.0.12 の
> `--print` はモデルの応答をインタラクティブな TUI 上にしかレンダリングしない;
> 非 TTY の stdout(hopper の dispatch は毎回これに該当する)では何も出力せず、
> dispatch は永遠に回答を得られない。そのため hopper は **agy への派遣を拒否**し、
> 明確なエラーを返す——あるプロジェクトの Approved Vendors 表に何が書かれていようと
> 関係ない。本当の修正には PTY が必要であり、agy は PTY 方式の対象から除外されている
> (開いた stdin パイプ上でハングしてしまうため)。この制限を理解した上でそれでも
> 試したい場合は `HOPPER_ENABLE_AGY=1` を設定すること。この注意書きは、上流での修正、
> あるいはサポートされたキャプチャ経路が用意され次第削除される——
> `docs/specs/vendor-io-protocol-current-vs-target.md` を参照。

## ガバナンスレイヤ(オプトイン)

デフォルトでは、hopper は1つのタスク種別 frame + spec を派遣し、vendor とホストの
設定を分離した状態に保つ。もし派遣されるすべての vendor に、共有された1つの行動規範
(たとえば fable の portable core)を遵守させたい場合は、オプトインで有効化できる:

```bash
hopper-dispatch --init-governance --from /path/to/fable/prompts/portable-agent-core.md
```

これにより `.hopper/GOVERNANCE.md`(規範へのポインタ + vendor 別 overlay 表)が
書き出され、`.hopper/governance/` 配下に vendor ごとにタイムスタンプ付きの規範コピーが
作られる。以降、`hopper-dispatch` はルーターが本来解決したのと同じ vendor を使いつつ、
「規範 + 対応する vendor の overlay」を組み立て済みの prompt の先頭に付加する。

- 全体を無効化する:`.hopper/GOVERNANCE.md` を削除する。
- 個別タスクだけ無効化する:`queue.md` に `Govern` 列を追加し、`off` に設定する。
- 規範そのものの著作権はアップストリーム(fable)に帰属する;hopper はタイムスタンプ
  付きのコピーを1部持つだけである。

これは prompt レベルの行動上の取り決めである;サンドボックス、タイムアウト、
ルーティングを変えるものではなく、「1回の spawn、リトライなし」という約束を変える
ものでもない。

## インストール

ホストごとの詳細なインストール手順は
[docs/release/INSTALL-MATRIX.md](docs/release/INSTALL-MATRIX.md) を参照。

Claude Code ユーザー:

```bash
mkdir -p ~/.claude/plugins
ln -s "$(pwd)" ~/.claude/plugins/hopper
```

Windows PowerShell:

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$HOME\.claude\plugins\hopper" `
  -Target "F:\absolute\path\to\hopper-plugin"
```

Codex CLI ユーザー:

```bash
chmod +x /absolute/path/to/hopper-plugin/hosts/codex-cli/bin/hopper-codex
ln -s /absolute/path/to/hopper-plugin/hosts/codex-cli/bin/hopper-codex ~/.local/bin/hopper-codex
```

Standalone:

```bash
npm link
hopper-dispatch --smoke
hopper-dispatch --vendors
```

Kimi Work ユーザー:`plugins/hopper/` をマネージドプラグインとしてインストールする。
このディレクトリには `kimi.plugin.json`(Kimi プラグイン manifest)、
`plugins/hopper/skills/` 配下の skills、`plugins/hopper/cli/` 配下の CLI が含まれて
いる——Kimi Work のプラグイン管理をこのディレクトリ(またはそのコピー)に向けると、
`kimi.plugin.json` から hopper の skills とインターフェースのメタデータを読み込んで
登録する。

## アップグレード

旧バージョンからのアップグレード、特に v0.40.0 をまたぐアップグレードについては
[MIGRATION.md](MIGRATION.md) を参照。

**v0.40.0 は既存プロジェクトにとって破壊的変更(breaking change)である**:これは
`.hopper/AGENTS.md` に新しいセクション `## Approved Vendors` を追加するものであり、
このセクションは fail-closed である——v0.40.0 より前に構築されたプロジェクトの
`.hopper/AGENTS.md` にこのセクションがまだ無い場合、アップグレード後は**すべての
vendor への dispatch が拒否される**。手動でこの表を補い、使いたい vendor に `yes` を
付けるまでこの状態は続く。これは段階的な警告ではなく、ハードな拒否である——
アップグレード前に MIGRATION.md の表を補う手順を確認すること。

## ドキュメント / ステータス / ライセンス

[docs/cookbook.md](docs/cookbook.md) から、dispatch、progress、通知、dashboard、
probe、古いタスクの掃除、そしてマルチ vendor レビューといったシナリオの完全な使い方を
参照できる。

- PRD:[docs/specs/background-progress-notification-prd-trd.md](docs/specs/background-progress-notification-prd-trd.md)
- インストールマトリクス:[docs/release/INSTALL-MATRIX.md](docs/release/INSTALL-MATRIX.md)
- Dashboard:[dashboard/README.md](dashboard/README.md)
- Telemetry マニュアル:[docs/specs/background-progress-notification-dogfood-telemetry-MANUAL.md](docs/specs/background-progress-notification-dogfood-telemetry-MANUAL.md)

ステータス:

- v1.0(progress + 終端通知):GA
- v1.1(dashboard 統合 + システム toast + ドキュメント):GA
- v1.2(pipe+tee + stream-parser + より多くの provider):計画中

ライセンス:MIT。[LICENSE](LICENSE) を参照。
