const test = require('node:test');
const assert = require('node:assert/strict');
const cloudinary = require('../src/config/cloudinary');
const cloudinaryService = require('../src/services/cloudinary.service');

function mockCloudinary(t, uploadStream) {
  const originalConfig = cloudinary.config;
  const originalUploadStream = cloudinary.uploader.upload_stream;
  cloudinary.config = () => ({
    cloud_name: 'test-cloud',
    api_key: 'test-key',
    api_secret: 'test-secret',
  });
  cloudinary.uploader.upload_stream = uploadStream;
  t.after(() => {
    cloudinary.config = originalConfig;
    cloudinary.uploader.upload_stream = originalUploadStream;
  });
}

test('downloads an Imou image and uploads its bytes to Cloudinary', async (t) => {
  const originalFetch = global.fetch;
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  let uploadedBuffer;
  let uploadOptions;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://snapshot.example/image.jpg');
    assert.equal(options.redirect, 'error');
    return new Response(image, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });
  mockCloudinary(t, (options, callback) => ({
    end(buffer) {
      uploadOptions = options;
      uploadedBuffer = Buffer.from(buffer);
      callback(null, {
        secure_url: 'https://res.cloudinary.com/test/image/upload/snapshot.jpg',
      });
    },
  }));

  const url = await cloudinaryService.uploadRemoteImage(
    'https://snapshot.example/image.jpg',
    'camera-snapshots',
  );
  assert.equal(url, 'https://res.cloudinary.com/test/image/upload/snapshot.jpg');
  assert.deepEqual(uploadedBuffer, image);
  assert.deepEqual(uploadOptions, {
    folder: 'camera-snapshots',
    resource_type: 'image',
  });
});

test('reports sanitized snapshot upload errors without exposing remote URL tokens', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(Buffer.from('image'), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  });
  t.after(() => {
    global.fetch = originalFetch;
  });
  mockCloudinary(t, (options, callback) => ({
    end() {
      callback(new Error(
        'Invalid image from https://snapshot.example/image.jpg?token=private api_secret=private',
      ));
    },
  }));

  await assert.rejects(
    cloudinaryService.uploadRemoteImage(
      'https://snapshot.example/image.jpg?token=private',
      'camera-snapshots',
    ),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /Invalid image/);
      assert.doesNotMatch(error.message, /snapshot\.example|private/);
      return true;
    },
  );
});
