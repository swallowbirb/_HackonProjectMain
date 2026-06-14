/**
 * One-off script: apply the CORS policy to the S3 bucket so the browser can
 * PUT pre-signed uploads from localhost and the production origin.
 *
 * Run: node set_s3_cors.js
 */
require('dotenv').config();
const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.S3_BUCKET_NAME || 'secondlife-marketplace-uploads';
const REGION = 'ap-south-1'; // bucket's actual region (overrides env for this script)

const client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const corsPolicy = {
  CORSRules: [
    {
      // Allow the browser to PUT pre-signed uploads from any localhost port,
      // plus the deployed frontend origin (update when you go to production).
      AllowedOrigins: [
        'http://localhost:3000',
        'http://localhost:5173',  // Vite dev server
        'http://localhost:5001',  // Express dev server (self-referential)
        '*',                      // Catch-all for hackathon — tighten in prod
      ],
      AllowedMethods: ['GET', 'PUT', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3000,
    },
  ],
};

async function apply() {
  console.log(`Applying CORS to bucket: ${BUCKET} (region: ${REGION})`);

  try {
    await client.send(new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: corsPolicy,
    }));
    console.log('✅ CORS policy applied successfully.');
  } catch (err) {
    console.error('❌ Failed to apply CORS:', err.message);
    console.error('   Code:', err.Code || err.name);
    process.exit(1);
  }

  // Verify it took.
  try {
    const res = await client.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
    console.log('\nVerified CORS rules now on bucket:');
    for (const rule of res.CORSRules || []) {
      console.log('  Origins :', rule.AllowedOrigins?.join(', '));
      console.log('  Methods :', rule.AllowedMethods?.join(', '));
      console.log('  Headers :', rule.AllowedHeaders?.join(', '));
    }
  } catch (err) {
    console.error('⚠️  Could not read back CORS rules:', err.message);
  }
}

apply();
