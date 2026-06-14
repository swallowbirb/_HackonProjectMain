import logging
import asyncio
from app.config import settings

logger = logging.getLogger("ml-service.textract")


class TextractService:
    def __init__(self):
        self._client = None

    @property
    def client(self):
        if self._client is None:
            import boto3
            from botocore.config import Config as BotoConfig
            self._client = boto3.client(
                "textract",
                region_name=settings.aws_region,
                aws_access_key_id=settings.aws_access_key_id,
                aws_secret_access_key=settings.aws_secret_access_key,
                config=BotoConfig(retries={"max_attempts": 1}),
            )
        return self._client

    async def extract_text(self, s3_bucket: str, s3_key: str) -> list:
        """Extract LINE text blocks from a document/image in S3."""
        def _call():
            response = self.client.detect_document_text(
                Document={"S3Object": {"Bucket": s3_bucket, "Name": s3_key}},
            )
            blocks = response.get("Blocks", [])
            return [b.get("Text") for b in blocks if b.get("BlockType") == "LINE" and b.get("Text")]

        return await asyncio.to_thread(_call)

    async def extract_text_bytes(self, image_bytes: bytes) -> list:
        """Extract LINE text strings from raw image bytes (serials, labels, care tags)."""
        def _call():
            response = self.client.detect_document_text(
                Document={"Bytes": image_bytes},
            )
            blocks = response.get("Blocks", [])
            return [b.get("Text") for b in blocks if b.get("BlockType") == "LINE" and b.get("Text")]

        return await asyncio.to_thread(_call)


textract_service = TextractService()
