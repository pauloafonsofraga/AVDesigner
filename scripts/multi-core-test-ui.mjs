export async function openMultiCorePicker(page) {
  await page.locator("#deviceEditorButton").click();
  await page.locator("#openDeviceEditorMultiCores").click();
}
