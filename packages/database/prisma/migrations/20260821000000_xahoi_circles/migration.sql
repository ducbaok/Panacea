-- XH-1 (21/08/2026) — MỘT migration duy nhất cho hướng Xã hội (PLAN_XAHOI.md §2).
-- Viết tay vì có partial index Prisma không diễn đạt được (tiền lệ: 20260728000100).
-- ⚠️ Chỉ `migrate deploy` — `migrate dev` sẽ đòi DROP các partial index (migrations/README.md).

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'FOLLOWERS', 'CIRCLE', 'ONLY_ME');

-- AlterTable: Pin nhận khán giả + hạn sống.
-- Mọi pin hiện có mặc định PUBLIC — đúng hành vi as-built, không cần backfill.
ALTER TABLE "Pin"
  ADD COLUMN "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN "audienceCircleId" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Circle" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER,
    "isAdHoc" BOOLEAN NOT NULL DEFAULT false,
    "memberHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Circle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CircleMember" (
    "circleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircleMember_pkey" PRIMARY KEY ("circleId","userId")
);

CREATE TABLE "PinView" (
    "pinId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinView_pkey" PRIMARY KEY ("pinId","viewerId")
);

-- CreateIndex (có trong schema.prisma)
CREATE INDEX "Circle_ownerId_idx" ON "Circle"("ownerId");
-- Postgres coi NULL ≠ NULL ⇒ unique này chỉ ràng vòng CÓ memberHash (vòng ad-hoc);
-- vòng đặt tên (memberHash null) không đụng nhau. Đúng chủ đích tái-dùng-vòng-trùng.
CREATE UNIQUE INDEX "Circle_ownerId_memberHash_key" ON "Circle"("ownerId", "memberHash");
-- Chiều "vòng tôi là thành viên" — getVisiblePinWhere lấy myCircleIds mỗi request
CREATE INDEX "CircleMember_userId_idx" ON "CircleMember"("userId");
CREATE INDEX "PinView_viewerId_idx" ON "PinView"("viewerId");

-- Partial index VIẾT TAY (KHÔNG có trong schema.prisma — Prisma không diễn đạt được;
-- cùng số phận với SavedPin_userId_pinId_no_board_key và Pin_fts_idx):
-- pin non-PUBLIC là thiểu số tuyệt đối, index thường trên visibility sẽ vô dụng vì PUBLIC áp đảo.
CREATE INDEX "Pin_visibility_nonpublic_idx" ON "Pin"("visibility") WHERE "visibility" <> 'PUBLIC';
-- Tra "mọi pin ghim vào vòng X" (chip vòng ở home, kiểm hồi tố khi rời vòng)
CREATE INDEX "Pin_audienceCircleId_idx" ON "Pin"("audienceCircleId") WHERE "audienceCircleId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_audienceCircleId_fkey" FOREIGN KEY ("audienceCircleId") REFERENCES "Circle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Circle" ADD CONSTRAINT "Circle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CircleMember" ADD CONSTRAINT "CircleMember_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CircleMember" ADD CONSTRAINT "CircleMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PinView" ADD CONSTRAINT "PinView_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "Pin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PinView" ADD CONSTRAINT "PinView_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
