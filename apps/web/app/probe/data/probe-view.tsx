'use client';

/*
 * FE-0b — View của trang probe. TEMPORARY, xoá khi FE-5/FE-6 dựng màn thật.
 *
 * Cập nhật 14/08/2026 (sau FE-4): các nhóm [E] explore, [C] comments, [R]
 * replies đã có màn thật (`/explore`, PinDetail). Vẫn giữ trang làm bằng
 * chứng regression rẻ + [T] unauth và [H] homeFeed source — hai nhánh chưa
 * có màn thật (chờ FE-5 login và FE-6 home 2 trạng thái).
 * Xem comment ở app/probe/data/page.tsx.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client/react';
/*
 * QUAN TRỌNG: import từ `@/lib/gql/graphql` (không phải `@/lib/gql`) vì
 * `lib/gql/index.ts` do codegen sinh ra và bị GHI ĐÈ mỗi lần `pnpm codegen`
 * chạy — client-preset chỉ re-export `./gql` (hàm template literal), không
 * re-export `./graphql` (Document + Query types).
 */
import { MeDocument, type MeQuery } from '@/lib/gql/graphql';
import {
  useExploreFeed,
  useHomeFeed,
  usePinComments,
  useCommentReplies,
} from '@/lib/hooks/usePaginatedQuery';
import { mapError, type LoadState } from '@/lib/errors/map-error';

function stateLabel(s: LoadState): string {
  switch (s.kind) {
    case 'locked':
      return `locked (retry ${s.retryAfterSec}s)`;
    case 'rate-limit':
      return `rate-limit: ${s.message}`;
    case 'validation':
      return `validation: ${s.message}`;
    case 'forbidden':
      return `forbidden: ${s.message}`;
    case 'unknown':
      return `unknown: ${s.message}`;
    default:
      return s.kind;
  }
}

export function ProbeDataView() {
  return (
    <main>
      <h1>FE-0b probe — tầng dữ liệu</h1>
      <p>
        <em>TEMPORARY — xoá khi FE-5/FE-6 dựng màn thật.</em>
      </p>
      <SectionMe />
      <hr />
      <SectionExplore />
      <hr />
      <SectionHome />
      <hr />
      <SectionComments />
      <hr />
      <SectionLoadMore />
    </main>
  );
}

// ------------------------------------------------------------
// [T] Query bắt buộc auth khi chưa đăng nhập → mapError = 'unauthenticated'
// ------------------------------------------------------------
function SectionMe() {
  const { data, loading, error } = useQuery<MeQuery>(MeDocument);
  const mapped = error ? mapError(error) : null;
  return (
    <section>
      <h2>[T] `me` (bắt buộc auth)</h2>
      <table border={1} cellPadding={4}>
        <tbody>
          <tr>
            <td>loading</td>
            <td>{String(loading)}</td>
          </tr>
          <tr>
            <td>error.kind (mapError)</td>
            <td>
              <strong data-error-kind={mapped?.kind ?? 'none'}>
                {mapped ? stateLabel(mapped) : '—'}
              </strong>
            </td>
          </tr>
          <tr>
            <td>me.username</td>
            <td>{data?.me.username ?? '—'}</td>
          </tr>
        </tbody>
      </table>
      <p>
        <small>
          Phép nghiệm: nếu chưa đăng nhập, <code>error.kind</code> phải bằng{' '}
          <code>unauthenticated</code> (KHÔNG phải <code>network</code>). Backend
          trả HTTP 200 + <code>errors: [{'{'} message: &quot;Unauthorized&quot; {'}'}]</code>.
        </small>
      </p>
    </section>
  );
}

// ------------------------------------------------------------
// [E] ExploreFeed — hai nhánh isSavedByViewer T/F trong cùng 1 response
// ------------------------------------------------------------
function SectionExplore() {
  const { items, loading, error, hasNextPage } = useExploreFeed({ first: 12 });
  const mapped = error ? mapError(error) : null;
  const savedCount = items.filter((i) => i.isSavedByViewer === true).length;
  const unsavedCount = items.filter((i) => i.isSavedByViewer === false).length;
  return (
    <section>
      <h2>[E] exploreFeed(first: 12)</h2>
      <p>
        loading={String(loading)} · hasNextPage={String(hasNextPage)} ·
        error={mapped ? stateLabel(mapped) : '—'}
      </p>
      <p>
        <strong>
          isSavedByViewer: {savedCount} true · {unsavedCount} false
        </strong>
        {savedCount > 0 && unsavedCount > 0
          ? ' ✓ hai nhánh cùng response'
          : items.length > 0
            ? ' ⚠ CHỈ 1 nhánh — token có thể không gắn'
            : ''}
      </p>
      <table border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>id</th>
            <th>creator</th>
            <th>title</th>
            <th>isSavedByViewer</th>
            <th>viewerReaction</th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, 12).map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.creator.username}</td>
              <td>{p.title ?? '—'}</td>
              <td>{String(p.isSavedByViewer)}</td>
              <td>{p.viewerReaction ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ------------------------------------------------------------
// [H] HomeFeed — source = FOLLOWING / EXPLORE
// ------------------------------------------------------------
function SectionHome() {
  const { items, source, loading, error } = useHomeFeed({ first: 3 });
  const mapped = error ? mapError(error) : null;
  return (
    <section>
      <h2>[H] homeFeed(first: 3)</h2>
      <p>
        loading={String(loading)} · source=<strong>{source ?? '—'}</strong> · error=
        {mapped ? stateLabel(mapped) : '—'}
      </p>
      <ol>
        {items.map((p) => (
          <li key={p.id}>
            {p.id} — {p.title ?? '(no title)'} — creator {p.creator.username}
          </li>
        ))}
      </ol>
      <p>
        <small>
          Phép nghiệm: đăng nhập tài khoản mới ⇒ source phải là{' '}
          <code>EXPLORE</code> (mặc định). Follow ai đó ⇒ vẫn có thể là EXPLORE
          hoặc FOLLOWING tuỳ số bài của người đó.
        </small>
      </p>
    </section>
  );
}

// ------------------------------------------------------------
// [C] pinComments (tầng 1) + [R] commentReplies (tầng 2, gọi RIÊNG)
// ------------------------------------------------------------
function SectionComments() {
  const [pinId, setPinId] = useState('pin_1_id');
  const [replyOf, setReplyOf] = useState<string | null>(null);

  const {
    items: comments,
    loading: cLoading,
    error: cError,
  } = usePinComments({ pinId, first: 20 });
  const {
    items: replies,
    loading: rLoading,
    error: rError,
  } = useCommentReplies(
    { commentId: replyOf ?? '', first: 20 },
    { skip: !replyOf },
  );

  const cMapped = cError ? mapError(cError) : null;
  const rMapped = rError ? mapError(rError) : null;

  return (
    <section>
      <h2>[C] pinComments + [R] commentReplies</h2>
      <p>
        pinId:{' '}
        <input value={pinId} onChange={(e) => setPinId(e.target.value)} size={20} />
        {' '}loading={String(cLoading)} error={cMapped ? stateLabel(cMapped) : '—'}
      </p>
      <table border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>id</th>
            <th>user</th>
            <th>content</th>
            <th>replyCount</th>
            <th>reactionCount</th>
            <th>viewer</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {comments.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.user?.username ?? '—'}</td>
              <td>{c.content}</td>
              <td>{c.replyCount ?? 0}</td>
              <td>{c.reactionCount ?? 0}</td>
              <td>{String(c.isReactedByViewer ?? false)}</td>
              <td>
                <button type="button" onClick={() => setReplyOf(c.id)}>
                  ↳ replies
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {replyOf && (
        <div>
          <h3>
            [R] commentReplies(commentId={replyOf}) —{' '}
            <button type="button" onClick={() => setReplyOf(null)}>đóng</button>
          </h3>
          <p>
            loading={String(rLoading)} error={rMapped ? stateLabel(rMapped) : '—'}
          </p>
          <ul>
            {replies.map((r) => (
              <li key={r.id}>
                {r.user?.username ?? '—'}: {r.content}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p>
        <small>
          Phép nghiệm: backend chỉ trả root ở <code>pinComments</code>
          (parentId=null); reply là <code>commentReplies</code> gọi RIÊNG
          từng comment — KHÔNG nested.
        </small>
      </p>
    </section>
  );
}

// ------------------------------------------------------------
// [P] loadMore không trùng, không thiếu
// ------------------------------------------------------------
function SectionLoadMore() {
  const { items, hasNextPage, loadMore, loading, loadingMore } = useExploreFeed({
    first: 3,
  });
  const idSet = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const isUnique = idSet.size === items.length;
  return (
    <section>
      <h2>[P] loadMore trên exploreFeed(first: 3)</h2>
      <p>
        items={items.length} · unique={idSet.size} ·{' '}
        {isUnique ? '✓ không trùng' : '✗ TRÙNG'} · hasNextPage=
        {String(hasNextPage)} · loading={String(loading)} · loadingMore=
        {String(loadingMore)}
      </p>
      <button type="button" onClick={() => void loadMore()} disabled={!hasNextPage}>
        loadMore →
      </button>
      <ol>
        {items.map((i) => (
          <li key={i.id}>{i.id}</li>
        ))}
      </ol>
      <p>
        <small>
          Phép nghiệm: bấm <code>loadMore</code> 3 lần, tổng số item = 3×lần
          bấm+3, tập id vẫn unique. So sánh với một lần gọi{' '}
          <code>exploreFeed(first:12)</code> ở section [E] ở trên: cùng 12 id,
          cùng thứ tự.
        </small>
      </p>
    </section>
  );
}
