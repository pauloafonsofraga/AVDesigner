export async function openMultiCorePicker(page) {
  // Exercise the legacy placement and definition flows without a product UI entry.
  await page.evaluate(() => activeEngineBridge().openMultiCorePicker());
}
