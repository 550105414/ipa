import ExpoModulesCore
import Foundation
import WidgetKit

private let appGroupIdentifier = "group.com.xiaoke.salesworkspace"
private let widgetKind = "TodoWidget"
private let snapshotFileName = "todo-widget-snapshot.json"

private final class WidgetContainerUnavailableException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Widget App Group container is unavailable: \(param)"
  }
}

private final class WidgetSnapshotInvalidException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Widget snapshot is invalid: \(param)"
  }
}

public class CardWorkbenchWidgetSnapshotModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CardWorkbenchWidgetSnapshot")

    AsyncFunction("writeSnapshotAsync") { (snapshotJSON: String) throws -> [String: Any] in
      let data = Data(snapshotJSON.utf8)
      guard
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        let updatedAt = object["updatedAt"] as? String,
        !updatedAt.isEmpty,
        let tasks = object["tasks"] as? [Any]
      else {
        throw WidgetSnapshotInvalidException("missing updatedAt or tasks")
      }

      guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupIdentifier
      ) else {
        throw WidgetContainerUnavailableException(appGroupIdentifier)
      }

      let fileURL = containerURL.appendingPathComponent(snapshotFileName, isDirectory: false)
      try data.write(to: fileURL, options: [.atomic])
      try? FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: fileURL.path
      )

      WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)

      return [
        "updatedAt": updatedAt,
        "taskCount": tasks.count,
        "byteCount": data.count,
      ]
    }

    AsyncFunction("readSnapshotAsync") { () throws -> String? in
      guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupIdentifier
      ) else {
        throw WidgetContainerUnavailableException(appGroupIdentifier)
      }

      let fileURL = containerURL.appendingPathComponent(snapshotFileName, isDirectory: false)
      guard FileManager.default.fileExists(atPath: fileURL.path) else {
        return nil
      }
      return try String(contentsOf: fileURL, encoding: .utf8)
    }

    Function("reload") {
      WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
    }
  }
}
