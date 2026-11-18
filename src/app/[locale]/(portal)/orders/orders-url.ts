// Builds the Orders page address in the browser. The server parses it again with parseOrderListQuery,
// so a value here only needs to be one the page offered; null (or '') removes the parameter.
export type ParamChanges = Record<string, string | null>;

export const ORDERS_PATH = '/orders';

// Any change of filter, search, tab or sort starts again at page 1, so `page` is dropped unless set.
export function ordersHref(currentSearch: string, changes: ParamChanges): string {
  const params = new URLSearchParams(currentSearch);
  params.delete('page');
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') params.delete(key);
    else params.set(key, value);
  }
  const search = params.toString();
  return search ? `${ORDERS_PATH}?${search}` : ORDERS_PATH;
}
