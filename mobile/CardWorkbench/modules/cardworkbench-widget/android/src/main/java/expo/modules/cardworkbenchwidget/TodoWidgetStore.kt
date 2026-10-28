package expo.modules.cardworkbenchwidget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal object TodoWidgetStore {
  private const val PREFERENCES = "cardworkbench_todo_widget"
  private const val SNAPSHOT = "snapshot_v2"
  private const val MAX_SNAPSHOT_CHARS = 1_048_576

  private fun parse(source: String): WidgetSnapshot {
    require(source.length <= MAX_SNAPSHOT_CHARS) { "Widget snapshot is too large." }
    val json = JSONObject(source)
    require(json.getInt("schemaVersion") == 2) { "Unsupported widget snapshot." }
    val rows = json.getJSONArray("tasks")
    val tasks = ArrayList<WidgetTask>()
    for (index in 0 until rows.length()) {
      val row = rows.optJSONObject(index) ?: continue
      val id = row.optString("id").trim().take(128)
      val title = row.optString("title").trim().take(300)
      if (id.isEmpty() || title.isEmpty()) continue
      tasks.add(WidgetTask(
        id,
        title,
        row.optString("accent", "#3B78B9").take(16),
        row.optBoolean("starred", false),
        if (row.isNull("dueAt")) null else row.optString("dueAt").trim().ifEmpty { null },
      ))
    }
    val state = json.optString("syncState", "ready")
      .takeIf { it == "ready" || it == "unpaired" || it == "error" } ?: "ready"
    return WidgetSnapshot(tasks, state)
  }

  fun save(context: Context, source: String) {
    val snapshot = parse(source)
    // Whitelist fields; never persist arbitrary native-call properties or App
    // credentials. Completed rows were already excluded by createWidgetSnapshot.
    val rows = JSONArray()
    snapshot.tasks.forEach { task ->
      rows.put(JSONObject().apply {
        put("id", task.id)
        put("title", task.title)
        put("accent", task.accent)
        put("starred", task.starred)
        put("dueAt", task.dueAt ?: JSONObject.NULL)
      })
    }
    val sanitized = JSONObject().apply {
      put("schemaVersion", 2)
      put("syncState", snapshot.syncState)
      put("tasks", rows)
    }.toString()
    check(context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
      .putString(SNAPSHOT, sanitized).commit()) { "Could not persist widget snapshot." }
  }

  fun load(context: Context): WidgetSnapshot? {
    val source = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .getString(SNAPSHOT, null) ?: return null
    return try {
      parse(source)
    } catch (_: Exception) {
      null
    }
  }
}
