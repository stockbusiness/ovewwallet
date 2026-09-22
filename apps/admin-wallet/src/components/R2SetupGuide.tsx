/**
 * カード画像の保管先に入れる4つの値 (バケット名・エンドポイント・アクセスキーID・
 * シークレット) を、Cloudflare R2 でどう取得するかの手順。
 *
 * 画面を見ただけでは「どこから持ってくる値なのか」が分からず設定が止まるため、
 * 設定欄と同じページに置く。文言は先方サービスの画面に依存するので、ラベルの
 * 完全一致ではなく「何をする操作か」で書いている。
 */
export default function R2SetupGuide() {
  return (
    <ol className="list-decimal space-y-4 pl-5">
      <li>
        <p className="font-semibold text-sengoku-text">バケットを作る</p>
        <p>
          Cloudflare のダッシュボードで R2 を開き、バケットを新規作成します。付けた名前を
          下の<strong>バケット名</strong>へ入れてください (例:{" "}
          <code>sennokuni-collectible-images</code>)。
        </p>
        <p className="mt-1">
          <strong>公開アクセスは有効にしないでください。</strong>
          ウォレットがサーバー側で読み出して配信するため、
          <strong>バケットは非公開のままで動きます。</strong>
          公開にすると、URLを知った人が直接取得できる範囲が無用に広がります。
        </p>
      </li>

      <li>
        <p className="font-semibold text-sengoku-text">エンドポイントを組み立てる</p>
        <p>
          R2 の画面に表示される<strong>アカウントID</strong>を控え、次の形にして
          <strong>エンドポイント</strong>へ入れます。
        </p>
        <p className="mt-1">
          <code>https://&lt;アカウントID&gt;.r2.cloudflarestorage.com</code>
        </p>
        <p className="mt-1">
          <strong>末尾にバケット名は付けません。</strong>バケットは別の欄で指定します。
        </p>
      </li>

      <li>
        <p className="font-semibold text-sengoku-text">APIトークンを発行する</p>
        <p>
          R2 の「APIトークン」を作成する画面で、S3互換のキーを発行します。
        </p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            権限は<strong>オブジェクトの読み取りと書き込み</strong>。
            読み取りのみだと保存はできても<strong>接続テストの書き込みで失敗します</strong>
          </li>
          <li>適用範囲は、1で作ったバケットだけに絞ることをお勧めします</li>
          <li>
            発行後に<strong>アクセスキーID</strong>と<strong>シークレットアクセスキー</strong>
            が表示されます
          </li>
        </ul>
        <p className="mt-1">
          <strong>シークレットはこの画面を閉じると二度と表示されません。</strong>
          先に控えてから閉じてください (紛失した場合は新しいトークンを発行し直します)。
        </p>
      </li>

      <li>
        <p className="font-semibold text-sengoku-text">この画面に入力して保存する</p>
        <p>
          リージョンは <code>auto</code> のままで構いません (R2 では使われません)。
          変更理由は操作ログに残るので、後から経緯を追えるように書いてください。
        </p>
      </li>

      <li>
        <p className="font-semibold text-sengoku-text">接続テストを実行する</p>
        <p>
          保存した設定で実際に書き込みと読み戻しを行います。成功すれば設定完了です。
          以降、届いたカード画像が自動で取り込まれるようになります。
        </p>
      </li>
    </ol>
  );
}

/**
 * 接続テストが失敗したときの切り分け。エラー文面から原因を引けるようにする
 * (どの値を間違えても「失敗しました」としか出ないため、ここが無いと総当たりになる)。
 */
export function R2TroubleshootingGuide() {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs [&_th]:whitespace-nowrap">
          <thead className="text-sengoku-faint">
            <tr>
              <th className="py-1 pr-3 font-normal">エラーに含まれる語</th>
              <th className="py-1 font-normal">よくある原因</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-sengoku-border">
              <td className="py-1 pr-3 align-top">
                <code>Access Denied</code> / <code>403</code>
              </td>
              <td className="py-1">
                トークンの権限が読み取りのみ。または適用範囲に、このバケットが入っていない
              </td>
            </tr>
            <tr className="border-t border-sengoku-border">
              <td className="py-1 pr-3 align-top">
                <code>NoSuchBucket</code> / <code>404</code>
              </td>
              <td className="py-1">
                バケット名の綴り違い。またはエンドポイントのアカウントIDが別アカウントのもの
              </td>
            </tr>
            <tr className="border-t border-sengoku-border">
              <td className="py-1 pr-3 align-top">
                <code>InvalidAccessKeyId</code> / <code>SignatureDoesNotMatch</code>
              </td>
              <td className="py-1">
                キーの貼り付け間違い、または前後に空白が混ざっている。シークレットは
                再発行が必要な場合あり
              </td>
            </tr>
            <tr className="border-t border-sengoku-border">
              <td className="py-1 pr-3 align-top">接続できない / タイムアウト</td>
              <td className="py-1">
                エンドポイントの綴り。<code>https://</code> から始まり、末尾にバケット名を
                付けていないか確認
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3">
        <strong>保存だけでは使われません。</strong>バケット・アクセスキーID・シークレットの
        3つが揃って初めて有効になります。1つでも空欄だと取り込みを行わず、マーケットの
        URLをそのまま表示する動作に戻ります。
      </p>
    </>
  );
}

/** Amazon S3 を使う場合の違いだけを示す。手順の大枠はR2と同じ。 */
export function S3SetupNote() {
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li>
        <strong>エンドポイントは空欄</strong>にします (AWSの既定の宛先を使います)
      </li>
      <li>
        <strong>リージョンは実際の値</strong>を入れます (例: <code>ap-northeast-1</code>)。
        <code>auto</code> のままでは動きません
      </li>
      <li>
        キーは IAM で発行し、対象バケットに対する <code>s3:GetObject</code> と{" "}
        <code>s3:PutObject</code> を許可してください
      </li>
    </ul>
  );
}
