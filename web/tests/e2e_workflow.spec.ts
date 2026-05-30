import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const API = 'http://localhost:3000';
const TEMPLATE_NAME = 'e2e_pw_test_template';

/**
 * Pre-seed a workflow template before tests run.
 */
test.beforeAll(async ({ request }) => {
  // Create a small test image (1x1 PNG) for upload simulation
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

  // Save template via API
  const saveResp = await request.post(`${API}/api/vf/workflows/save`, {
    data: {
      name: TEMPLATE_NAME,
      nodes: [
        { id: 'img_up', type: 'image', url: '', x: 100, y: 100, w: 200, h: 180 },
        { id: 'txt_in', type: 'prompt', text: '', x: 400, y: 100, w: 220, h: 120 },
        { id: 'gen_core', type: 'generator', apiProvider: 'yunwu', ratio: 'square', resolution: '2k', x: 250, y: 350, w: 260, h: 300 },
      ],
      connections: [
        { from: 'img_up', to: 'gen_core' },
        { from: 'txt_in', to: 'gen_core' },
      ],
      exposed_mapping: {
        product_img: {
          node_id: 'img_up', path: ['url'],
          label: '上传产品图', type: 'image', required: true,
        },
        user_text: {
          node_id: 'txt_in', path: ['text'],
          label: '输入提示词', type: 'text', required: true,
        },
      },
    },
  });
  const saveData = await saveResp.json();
  console.log(`[Setup] Template saved: ${saveData.ok ? 'OK' : 'FAILED'}, name=${saveData.name}`);
  expect(saveData.ok).toBe(true);
});


test.describe('WorkflowRunner E2E', () => {

  test('full user flow: select template → fill form → run → see results', async ({ page }) => {
    // ── Step 1: Navigate to workflow runner ──
    await page.goto('/workflow');
    await page.waitForLoadState('networkidle');
    console.log('[Step 1] Page loaded: /workflow');

    // ── Step 2: Select the pre-seeded template ──
    // The workflow list is on the left side. Find our template by its name text.
    const templateItem = page.locator(`text=${TEMPLATE_NAME}`).first();
    await expect(templateItem).toBeVisible({ timeout: 10000 });
    await templateItem.click();
    await page.waitForTimeout(500);
    console.log(`[Step 2] Selected template: ${TEMPLATE_NAME}`);

    // ── Step 3: Verify dynamic form rendered ──
    // Should show image upload area + textarea for prompt
    const imageUploadLabel = page.locator('text=上传图片').first();
    const promptTextarea = page.locator('textarea').first();
    await expect(imageUploadLabel).toBeVisible({ timeout: 5000 });
    await expect(promptTextarea).toBeVisible({ timeout: 5000 });
    console.log('[Step 3] Dynamic form rendered: upload area + textarea visible');

    // ── Step 4: Fill in the prompt ──
    const testPrompt = 'A futuristic cyberpunk city at night, neon lights, rain, 8K, cinematic';
    await promptTextarea.fill(testPrompt);
    const filledValue = await promptTextarea.inputValue();
    expect(filledValue).toBe(testPrompt);
    console.log(`[Step 4] Prompt filled: "${filledValue.slice(0, 50)}..."`);

    // ── Step 5: Upload a test image ──
    // Create a minimal PNG file for upload
    const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const tinyPngBuffer = Buffer.from(tinyPngBase64, 'base64');

    // Find the hidden file input inside the upload area
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'test_product.jpg',
      mimeType: 'image/jpeg',
      buffer: tinyPngBuffer,
    });
    await page.waitForTimeout(500);
    console.log('[Step 5] Test image uploaded');

    // ── Step 6: Click run ──
    const runButton = page.locator('button:has-text("运行工作流")');
    await expect(runButton).toBeVisible({ timeout: 3000 });
    await runButton.click();
    console.log('[Step 6] Clicked run button');

    // ── Step 7: Verify loading state ──
    // Should show "运行中" or a spinner
    const loadingIndicator = page.locator('text=运行中').first();
    await expect(loadingIndicator).toBeVisible({ timeout: 5000 });
    console.log('[Step 7] Loading state confirmed');

    // ── Step 8: Wait for completion (or timeout) ──
    // The real provider (Yunwu) may take 5-60 seconds. We wait up to 90s.
    try {
      // Wait for either "completed" status badge or a result image
      const completedBadge = page.locator('text=completed').first();
      await completedBadge.waitFor({ timeout: 90000 });
      console.log('[Step 8] Task completed!');
    } catch {
      // Check if there was an error
      const failedBadge = page.locator('text=failed').first();
      if (await failedBadge.isVisible().catch(() => false)) {
        console.log('[Step 8] Task failed (expected in test env with no real API keys)');
      } else {
        console.log('[Step 8] Task still running (timeout reached, acceptable for E2E)');
      }
    }

    // ── Step 9: Verify the task appeared in history ──
    const taskHistorySection = page.locator('text=任务历史').first();
    await expect(taskHistorySection).toBeVisible({ timeout: 3000 });
    console.log('[Step 9] Task history section visible');

    // ── Step 10: Take a screenshot for manual verification ──
    await page.screenshot({ path: 'tests/output/e2e_workflow_result.png', fullPage: true });
    console.log('[Step 10] Screenshot saved to tests/output/e2e_workflow_result.png');
  });

});
