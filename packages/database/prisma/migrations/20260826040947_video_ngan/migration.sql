-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('READY', 'PROCESSING', 'FAILED');

-- AlterTable
ALTER TABLE "Pin" ADD COLUMN     "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'READY',
ADD COLUMN     "videoDurationMs" INTEGER,
ADD COLUMN     "videoUrl" TEXT;
