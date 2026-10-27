/**
 * Decode an image as a PDF image, not as a standalone JPEG. /Decode, ICC profiles,
 * resource color spaces and soft masks live outside the compressed image bytes.
 * A one-image PDF preserves those objects without rendering/cropping a whole page
 * or trying to pair equal-sized pictures by their dimensions.
 * Dependencies are injected so Node tests and the Deno worker use the same code.
 */
export function collectPdfPageImages(pdfLib, document, pageNumber) {
  const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream } = pdfLib;
  const images = [];
  const active = new Set();
  function visit(resources, depth = 0) {
    const objects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!objects || depth > 8 || active.has(objects)) return;
    active.add(objects);
    for (const [, ref] of objects.entries()) {
      const stream = document.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      const subtype = stream.dict.lookup(PDFName.of('Subtype'));
      if (subtype === PDFName.of('Form')) {
        visit(stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? resources, depth + 1);
      } else if (subtype === PDFName.of('Image') && String(stream.dict.get(PDFName.of('ImageMask'))) !== 'true') {
        const w = stream.dict.lookup(PDFName.of('Width'));
        const h = stream.dict.lookup(PDFName.of('Height'));
        const width = w instanceof PDFNumber ? w.asNumber() : 0;
        const height = h instanceof PDFNumber ? h.asNumber() : 0;
        const filter = stream.dict.lookup(PDFName.of('Filter'));
        const filters = filter instanceof PDFArray ? filter.asArray() : filter ? [filter] : [];
        images.push({ bytes: stream.contents, stream, resources, width, height, area: width * height,
          jpeg: filters.length === 1 && filters[0] === PDFName.of('DCTDecode') });
      }
    }
    active.delete(objects);
  }
  visit(document.getPage(pageNumber - 1).node.Resources());
  return images;
}

export function createPdfImageNormalizer({ pdfLib, getDocumentProxy, extractImages, encodeJpeg }) {
  const { PDFDocument, PDFDict, PDFName, PDFObjectCopier, drawObject } = pdfLib;
  return async (document, image) => {
    if (!(image.width > 0 && image.height > 0) || image.width * image.height > 12_000_000) {
      throw new Error(`Unsupported PDF image dimensions: ${image.width} x ${image.height}`);
    }
    const single = await PDFDocument.create();
    const copier = PDFObjectCopier.for(document.context, single.context);
    const stream = copier.copy(image.stream);
    const ref = single.context.register(stream);
    const colorSpaces = image.resources?.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
    // Resolve resource aliases/default device profiles explicitly. Image decoders
    // may otherwise interpret a name without the enclosing page's resources.
    const sourceColor = image.stream.dict.lookup(PDFName.of('ColorSpace'));
    if (sourceColor instanceof PDFName && colorSpaces) {
      const name = sourceColor.asString().slice(1);
      const alias = colorSpaces.lookup(PDFName.of(name));
      const defaultName = { DeviceRGB: 'DefaultRGB', DeviceCMYK: 'DefaultCMYK', DeviceGray: 'DefaultGray' }[name];
      const replacement = alias ?? (defaultName ? colorSpaces.lookup(PDFName.of(defaultName)) : undefined);
      if (replacement) stream.dict.set(PDFName.of('ColorSpace'), copier.copy(replacement));
    }
    const page = single.addPage([1, 1]);
    page.node.set(PDFName.of('Resources'), single.context.obj({
      XObject: { ExtractedImage: ref },
      ...(colorSpaces ? { ColorSpace: copier.copy(colorSpaces) } : {}),
    }));
    page.pushOperators(drawObject('ExtractedImage'));
    const pdf = await getDocumentProxy(await single.save(), {
      disableFontFace: true,
      useSystemFonts: false,
      isEvalSupported: false,
      // Keep RGB(A) pixels in JS; serverless Edge has no ImageBitmap/canvas.
      isImageDecoderSupported: false,
      isOffscreenCanvasSupported: false,
      stopAtErrors: true,
      wasmUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/wasm/',
    });
    try {
      let timeout;
      const images = await Promise.race([
        extractImages(pdf, 1),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('PDF image decoding timed out')), 15_000); }),
      ]).finally(() => clearTimeout(timeout));
      if (images.length !== 1) throw new Error('PDF decoder could not decode the image');
      const decoded = images[0];
      if (decoded.width !== image.width || decoded.height !== image.height) {
        throw new Error('PDF decoder returned unexpected image dimensions');
      }
      const { data, channels, width, height } = decoded;
      if (![1, 3, 4].includes(channels) || data.length !== width * height * channels) {
        throw new Error('PDF decoder returned unsupported image pixels');
      }
      const rgba = new Uint8Array(width * height * 4);
      for (let pixel = 0, source = 0, dest = 0; pixel < width * height; pixel++, source += channels, dest += 4) {
        const alpha = channels === 4 ? data[source + 3] / 255 : 1;
        // JPEG has no alpha: composite the PDF's decoded soft mask over white.
        for (let channel = 0; channel < 3; channel++) {
          rgba[dest + channel] = Math.round(data[source + (channels === 1 ? 0 : channel)] * alpha + 255 * (1 - alpha));
        }
        rgba[dest + 3] = 255;
      }
      return new Uint8Array(encodeJpeg({ width, height, data: rgba }, 90).data);
    } finally {
      if (typeof pdf.destroy === 'function') await pdf.destroy();
      else await pdf.cleanup();
    }
  };
}
