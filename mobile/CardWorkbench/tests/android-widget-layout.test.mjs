import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const native = new URL('../modules/cardworkbench-widget/android/src/main/', import.meta.url);
const info = await readFile(new URL('res/xml/cardworkbench_widget_info.xml', native), 'utf8');
const widget = await readFile(new URL('res/layout/cardworkbench_widget.xml', native), 'utf8');
const row = await readFile(new URL('res/layout/cardworkbench_widget_row.xml', native), 'utf8');
const provider = await readFile(new URL('java/expo/modules/cardworkbenchwidget/TodoWidgetProvider.kt', native), 'utf8');
const budget = await readFile(new URL('java/expo/modules/cardworkbenchwidget/TodoWidgetLayout.kt', native), 'utf8');

function view(xml, id) {
  const result = xml.match(new RegExp(`<\\w+\\b[^>]*android:id="@\\+id/${id}"[^>]*>`));
  assert.ok(result, `Missing view ${id}`);
  return result[0];
}

test('Android widget defaults to 2×2 and can resize down without the old 180dp floor', () => {
  assert.match(info, /android:targetCellWidth="2"/);
  assert.match(info, /android:targetCellHeight="2"/);
  for (const dimension of ['minWidth', 'minHeight', 'minResizeWidth', 'minResizeHeight']) {
    assert.match(info, new RegExp(`android:${dimension}="110dp"`));
  }
  assert.match(info, /android:resizeMode="horizontal\|vertical"/);
  assert.doesNotMatch(info, /180dp/);
});

test('compact XML stays aligned with native line-height budget and single-line task fields', () => {
  assert.match(widget, /android:padding="12dp"/);
  assert.match(widget, /android:minHeight="26dp"/);
  assert.match(widget, /android:text="全部" android:textSize="18sp"/);
  assert.match(view(widget, 'cardworkbench_widget_count'), /android:textSize="12sp"/);
  assert.match(view(widget, 'cardworkbench_widget_empty'), /android:textSize="12sp"/);
  assert.match(view(widget, 'cardworkbench_widget_footer'), /android:textSize="10sp"/);
  assert.match(view(widget, 'cardworkbench_widget_footer'), /android:visibility="gone"/);
  assert.match(row, /android:paddingTop="4dp" android:paddingBottom="4dp"/);
  for (const [id, size] of [['title', 14], ['date', 10]]) {
    const field = view(row, `cardworkbench_widget_task_${id}`);
    assert.match(field, new RegExp(`android:textSize="${size}sp"`));
    assert.match(field, /android:singleLine="true"/);
    assert.match(field, /android:ellipsize="end"/);
  }
  assert.match(view(row, 'cardworkbench_widget_task_date'), /android:layout_marginTop="2dp"/);
  assert.match(view(row, 'cardworkbench_widget_task_circle'), /android:textSize="18sp"/);
  assert.match(budget, /PADDING = 12f/);
  assert.match(budget, /maxOf\(26f, line\(18f, scale\), line\(12f, scale\) \+ 6f\)/);
  assert.match(budget, /line\(14f, scale\).*2f \+ line\(10f, scale\)/);
});

test('provider renders only budgeted rows without changing due filtering, snapshot or alarms', () => {
  assert.match(provider, /TodoWidgetLayout\.plan\(height, fontScale, tasks\.map \{ it\.dueAt != null \}\)/);
  assert.match(provider, /tasks\.take\(layout\.visibleCount\)/);
  assert.match(provider, /filter \{ it\.isVisible\(now\) \}/);
  assert.match(provider, /TodoWidgetAlarms\.schedule\(context, snapshot, now\)/);
  assert.match(provider, /@Synchronized\s+fun updateAll/);
  assert.match(provider, /if \(layout\.showFooter\) View\.VISIBLE else View\.GONE/);
  assert.match(provider, /if \(layout\.visibleCount == 0\) View\.VISIBLE else View\.GONE/);
  assert.doesNotMatch(provider, /if \(limit > 0/);
  assert.doesNotMatch(provider, /TodoWidgetStore\.(save|clear|delete)/);
});
