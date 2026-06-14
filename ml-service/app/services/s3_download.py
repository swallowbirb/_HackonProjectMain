"""
Authenticated S3 object download.

The browser uploads evidence photos to a PRIVATE S3 bucket via a presigned PUT
URL. The presigned URL only authorizes the PUT; the bare object URL is not
publicly readable, so an unauthenticated HTTP GET returns 403 Forbidden.

This module downloads the object bytes using the ML service's AWS credentials
(boto3 ``GetObject``), which is the correct way to read from a private bucket.
"""
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger("ml-service.s3_download")


class S3DownloadService:
    def __init__(self):
        self._client = None

    @property
    def client(self):
        if self._client is None:
            import boto3
            from botocore.config import Config as BotoConfig
            self._client = boto3.client(
                "s3",
                region_name=settings.aws_region,
                aws_access_key_id=settings.aws_access_key_id,
                aws_secret_access_key=settings.aws_secret_access_key,
                config=BotoConfig(retries={"max_attempts": 2}),
            )
        return self._client

    def get_object_bytes(self, bucket: str, key: str) -> bytes:
        """Download an S3 object's raw bytes using authenticated GetObject."""
        response = self.client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()


s3_download_service = S3DownloadService()
