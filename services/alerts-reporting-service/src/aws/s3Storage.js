// Report files are stored in a PRIVATE S3 bucket. Users never get the bucket itself;
// they get a short-lived pre-signed link to one file, after an ownership check.
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const clients = require('./clients');
const config = require('../config');

async function putReport(key, body) {
  await clients.s3().send(new PutObjectCommand({
    Bucket: config.aws.reportsBucket,
    Key: key,
    Body: body,
    ContentType: 'text/csv; charset=utf-8',
    ServerSideEncryption: 'AES256', // encryption at rest
  }));
}

async function signedDownloadUrl(key, filename, expiresInSeconds = 300) {
  const cmd = new GetObjectCommand({
    Bucket: config.aws.reportsBucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });
  return getSignedUrl(clients.s3(), cmd, { expiresIn: expiresInSeconds });
}

async function deleteReport(key) {
  await clients.s3().send(new DeleteObjectCommand({ Bucket: config.aws.reportsBucket, Key: key }));
}

module.exports = { putReport, signedDownloadUrl, deleteReport };
