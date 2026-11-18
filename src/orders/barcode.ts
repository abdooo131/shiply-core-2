// The explicit node entry: labels are drawn on the server, and the bare name has no default types.
import { toSVG } from 'bwip-js/node';
import { AppError } from '@/shared/app-error';

const ORDER_NUMBER_PATTERN = /^\d{10}$/;
// Bar height and module width in millimetres; sized so a courier's scanner reads it off an A6 label.
const BAR_HEIGHT_MM = 14;
const MODULE_SCALE = 3;

// The output is placed in the page with dangerouslySetInnerHTML, so only a
// strictly validated order number may ever reach the encoder.
export function barcodeSvg(orderNumber: string): string {
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) throw new AppError('invalid_input');
  return toSVG({
    bcid: 'code128',
    text: orderNumber,
    scale: MODULE_SCALE,
    height: BAR_HEIGHT_MM,
    includetext: true,
    textxalign: 'center',
  });
}
