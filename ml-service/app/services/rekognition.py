import logging
from app.config import settings

logger = logging.getLogger("ml-service.rekognition")

# Rekognition collection / model version is fixed per region; surfaced for provenance.
REKOGNITION_VERSION = "aws-rekognition-2016-06-27"


class RekognitionService:
    def __init__(self):
        self._client = None

    @property
    def client(self):
        if self._client is None:
            import boto3
            from botocore.config import Config as BotoConfig
            self._client = boto3.client(
                "rekognition",
                region_name=settings.aws_region,
                aws_access_key_id=settings.aws_access_key_id,
                aws_secret_access_key=settings.aws_secret_access_key,
                config=BotoConfig(retries={"max_attempts": 1}),
            )
        return self._client

    async def detect_labels(self, s3_bucket: str, s3_key: str, max_labels: int = 20) -> list:
        """Detect labels for an image stored in S3 (by bucket/key)."""
        import asyncio

        def _call():
            response = self.client.detect_labels(
                Image={"S3Object": {"Bucket": s3_bucket, "Name": s3_key}},
                MaxLabels=max_labels,
                MinConfidence=50.0,
            )
            return response.get("Labels", [])

        return await asyncio.to_thread(_call)

    async def detect_labels_bytes(self, image_bytes: bytes, max_labels: int = 20) -> list:
        """Detect labels for raw image bytes (when the image is not an S3Object)."""
        import asyncio

        def _call():
            response = self.client.detect_labels(
                Image={"Bytes": image_bytes},
                MaxLabels=max_labels,
                MinConfidence=50.0,
            )
            return response.get("Labels", [])

        return await asyncio.to_thread(_call)

    async def detect_moderation_labels_bytes(self, image_bytes: bytes) -> list:
        """Detect unsafe/web content in raw image bytes."""
        import asyncio

        def _call():
            response = self.client.detect_moderation_labels(
                Image={"Bytes": image_bytes},
                MinConfidence=60.0,
            )
            return response.get("ModerationLabels", [])

        return await asyncio.to_thread(_call)


rekognition_service = RekognitionService()
