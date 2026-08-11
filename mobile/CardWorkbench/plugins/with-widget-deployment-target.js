const fs = require('node:fs');
const path = require('node:path');

const {
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} = require('expo/config-plugins');

const WIDGET_BUNDLE_IDENTIFIER = 'com.xiaoke.salesworkspace.TodoWidget';
const WIDGET_TARGET_NAME = 'ExpoWidgetsTarget';
const WIDGET_DISPLAY_NAME = '工作台待办';
const REQUIRED_DEPLOYMENT_TARGET = '16.1';
const NATIVE_WIDGET_MARKER = '// CardWorkbench native widget fallback';

const NATIVE_WIDGET_SWIFT = String.raw`${NATIVE_WIDGET_MARKER}

private struct TodoWidgetResilientTimelineProvider: TimelineProvider {
  typealias Entry = WidgetsTimelineEntry

  private let provider: WidgetsTimelineProvider

  init(name: String) {
    self.provider = WidgetsTimelineProvider(name: name)
  }

  func placeholder(in context: Context) -> Entry {
    provider.placeholder(in: context)
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping @Sendable (Entry) -> Void
  ) {
    provider.getSnapshot(in: context, completion: completion)
  }

  func getTimeline(
    in context: Context,
    completion: @escaping @Sendable (Timeline<Entry>) -> Void
  ) {
    let placeholderEntry = provider.placeholder(in: context)

    provider.getTimeline(in: context) { timeline in
      if timeline.entries.isEmpty {
        completion(Timeline(entries: [placeholderEntry], policy: .never))
      } else {
        completion(timeline)
      }
    }
  }
}

private struct CardWorkbenchWidgetTask: Identifiable {
  let id: String
  let title: String
  let accent: Color
  let starred: Bool
  let dueLabel: String?

  init(
    id: String,
    title: String,
    accentHex: String,
    starred: Bool,
    dueLabel: String?
  ) {
    self.id = id
    self.title = title
    self.accent = Color(cardWorkbenchHex: accentHex)
    self.starred = starred
    self.dueLabel = dueLabel
  }

  init?(dictionary: [String: Any], index: Int) {
    guard
      let title = dictionary["title"] as? String,
      !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return nil
    }

    if let id = dictionary["id"] as? String, !id.isEmpty {
      self.id = id
    } else if let id = dictionary["id"] as? NSNumber {
      self.id = id.stringValue
    } else {
      self.id = "task-" + String(index)
    }

    self.title = title
    self.accent = Color(
      cardWorkbenchHex: dictionary["accent"] as? String ?? "#3B78B9"
    )

    if let starred = dictionary["starred"] as? Bool {
      self.starred = starred
    } else {
      self.starred = (dictionary["starred"] as? NSNumber)?.boolValue ?? false
    }

    if
      let dueLabel = dictionary["dueLabel"] as? String,
      !dueLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
      self.dueLabel = dueLabel
    } else {
      self.dueLabel = nil
    }
  }
}

private struct CardWorkbenchWidgetModel {
  let total: Int
  let tasks: [CardWorkbenchWidgetTask]

  static let placeholder = CardWorkbenchWidgetModel(
    total: 16,
    tasks: [
      CardWorkbenchWidgetTask(
        id: "sample-1",
        title: "学习如何写文章",
        accentHex: "#9AA0A6",
        starred: true,
        dueLabel: "5月5日"
      ),
      CardWorkbenchWidgetTask(
        id: "sample-2",
        title: "订购桶装水",
        accentHex: "#F0A33A",
        starred: true,
        dueLabel: "5月11日"
      ),
      CardWorkbenchWidgetTask(
        id: "sample-3",
        title: "买花生油",
        accentHex: "#9AA0A6",
        starred: true,
        dueLabel: "6月11日"
      ),
      CardWorkbenchWidgetTask(
        id: "sample-4",
        title: "八月份选题计划",
        accentHex: "#2D9CDB",
        starred: true,
        dueLabel: "8月13日"
      ),
    ]
  )

  init(props: [String: Any]?) {
    guard let props else {
      self = .placeholder
      return
    }

    let rawTasks = props["tasks"] as? [Any] ?? []
    let parsedTasks: [CardWorkbenchWidgetTask] = rawTasks.enumerated().compactMap {
      index, rawTask -> CardWorkbenchWidgetTask? in
      guard let dictionary = rawTask as? [String: Any] else {
        return nil
      }

      return CardWorkbenchWidgetTask(dictionary: dictionary, index: index)
    }

    self.tasks = parsedTasks

    if let total = props["total"] as? NSNumber {
      self.total = max(total.intValue, parsedTasks.count)
    } else if let total = props["total"] as? Int {
      self.total = max(total, parsedTasks.count)
    } else {
      self.total = parsedTasks.count
    }
  }

  private init(total: Int, tasks: [CardWorkbenchWidgetTask]) {
    self.total = total
    self.tasks = tasks
  }
}

private struct CardWorkbenchTodoWidgetView: View {
  @Environment(\.widgetFamily) private var widgetFamily

  private let model: CardWorkbenchWidgetModel

  init(entry: WidgetsTimelineEntry) {
    self.model = CardWorkbenchWidgetModel(props: entry.props)
  }

  @ViewBuilder
  var body: some View {
    if #available(iOS 17.0, *) {
      content
        .containerBackground(Color(uiColor: .systemBackground), for: .widget)
    } else {
      content
        .background(Color(uiColor: .systemBackground))
    }
  }

  private var maximumTaskCount: Int {
    widgetFamily == .systemSmall ? 3 : 5
  }

  private var content: some View {
    VStack(alignment: .leading, spacing: 7) {
      HStack(spacing: 7) {
        Image(systemName: "list.bullet.rectangle")
          .font(.system(size: 17, weight: .semibold))
          .foregroundStyle(Color(cardWorkbenchHex: "#3B78B9"))
          .accessibilityHidden(true)

        Text("全部")
          .font(.system(size: 17, weight: .bold))
          .foregroundStyle(Color(cardWorkbenchHex: "#3B78B9"))

        Spacer(minLength: 4)

        Text(String(model.total))
          .font(.system(size: 13, weight: .bold))
          .monospacedDigit()
          .foregroundStyle(Color(uiColor: .label))
          .padding(.horizontal, 9)
          .padding(.vertical, 4)
          .background(Color(uiColor: .tertiarySystemFill), in: Capsule())
      }

      if model.tasks.isEmpty {
        Spacer(minLength: 0)

        HStack {
          Spacer(minLength: 0)
          Label("暂无待办", systemImage: "checkmark.circle")
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Color(uiColor: .secondaryLabel))
          Spacer(minLength: 0)
        }

        Spacer(minLength: 0)
      } else {
        ForEach(Array(model.tasks.prefix(maximumTaskCount))) { task in
          HStack(spacing: 7) {
            Image(systemName: "circle")
              .font(.system(size: 14, weight: .medium))
              .foregroundStyle(task.accent)
              .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 1) {
              Text(task.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color(uiColor: .label))
                .lineLimit(1)
                .minimumScaleFactor(0.75)

              if let dueLabel = task.dueLabel {
                HStack(spacing: 3) {
                  Image(systemName: "calendar")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(task.accent)
                    .accessibilityHidden(true)

                  Text(dueLabel)
                    .font(.system(size: 10, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(task.accent)
                    .lineLimit(1)
                }
              }
            }

            Spacer(minLength: 2)

            Image(systemName: task.starred ? "star.fill" : "star")
              .font(.system(size: 14, weight: .semibold))
              .foregroundStyle(
                task.starred
                  ? Color(cardWorkbenchHex: "#FF962E")
                  : Color(uiColor: .tertiaryLabel)
              )
              .accessibilityHidden(true)
          }
          .accessibilityElement(children: .combine)
          .accessibilityLabel(
            Text(task.title + (task.starred ? "，已星标" : "，未星标"))
          )
        }

        Spacer(minLength: 0)
      }
    }
    .padding(12)
    .widgetURL(URL(string: "cardworkbench://plan"))
  }
}

private extension Color {
  init(cardWorkbenchHex: String) {
    let valueString = cardWorkbenchHex.hasPrefix("#")
      ? String(cardWorkbenchHex.dropFirst())
      : cardWorkbenchHex

    guard
      valueString.count == 6,
      let value = UInt64(valueString, radix: 16)
    else {
      self = Color(red: 59.0 / 255.0, green: 120.0 / 255.0, blue: 185.0 / 255.0)
      return
    }

    self.init(
      .sRGB,
      red: Double((value >> 16) & 0xFF) / 255.0,
      green: Double((value >> 8) & 0xFF) / 255.0,
      blue: Double(value & 0xFF) / 255.0,
      opacity: 1
    )
  }
}`;

function replaceExactlyOnce(source, search, replacement) {
  const count = source.split(search).length - 1;

  if (count !== 1) {
    throw new Error(
      `Expected exactly one generated widget marker ${JSON.stringify(search)}, found ${count}.`,
    );
  }

  return source.replace(search, replacement);
}

function patchGeneratedWidgetSource(source) {
  if (source.includes(NATIVE_WIDGET_MARKER)) {
    return source;
  }

  let patched = replaceExactlyOnce(
    source,
    'internal import ExpoWidgets',
    'internal import ExpoWidgets\nimport Foundation',
  );
  patched = replaceExactlyOnce(
    patched,
    'provider: WidgetsTimelineProvider(name: name)',
    'provider: TodoWidgetResilientTimelineProvider(name: name)',
  );
  patched = replaceExactlyOnce(
    patched,
    'WidgetsEntryView(entry: entry)',
    'CardWorkbenchTodoWidgetView(entry: entry)',
  );

  return `${patched.trimEnd()}\n\n${NATIVE_WIDGET_SWIFT}\n`;
}

function withNativeTodoWidget(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const widgetPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        WIDGET_TARGET_NAME,
        'TodoWidget.swift',
      );

      if (!fs.existsSync(widgetPath)) {
        throw new Error(`Generated widget source was not found: ${widgetPath}`);
      }

      const source = fs.readFileSync(widgetPath, 'utf8');
      fs.writeFileSync(widgetPath, patchGeneratedWidgetSource(source), 'utf8');

      return modConfig;
    },
  ]);
}

/**
 * expo-widgets 55 creates its extension target with iOS 16.2 and an
 * unoptimized debug-dylib Release layout. Keep the extension compatible with
 * iOS 16.1 and emit a normal optimized WidgetKit executable for TrollStore.
 */
module.exports = function withWidgetDeploymentTarget(config) {
  const withNativeRenderer = withNativeTodoWidget(config);
  const withoutUnusedPushEntitlement = withEntitlementsPlist(
    withNativeRenderer,
    (modConfig) => {
      delete modConfig.modResults['aps-environment'];
      return modConfig;
    },
  );

  return withXcodeProject(withoutUnusedPushEntitlement, (projectConfig) => {
    const buildConfigurations = projectConfig.modResults.pbxXCBuildConfigurationSection();
    let updatedConfigurations = 0;
    let updatedReleaseConfigurations = 0;

    for (const entry of Object.values(buildConfigurations)) {
      if (!entry || typeof entry !== 'object' || !entry.buildSettings) {
        continue;
      }

      const bundleIdentifier = String(
        entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER ?? '',
      ).replaceAll('"', '');

      if (bundleIdentifier !== WIDGET_BUNDLE_IDENTIFIER) {
        continue;
      }

      entry.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = `"${REQUIRED_DEPLOYMENT_TARGET}"`;
      entry.buildSettings.INFOPLIST_KEY_CFBundleDisplayName = `"${WIDGET_DISPLAY_NAME}"`;
      entry.buildSettings.INFOPLIST_KEY_CFBundleName = '"TodoWidget"';
      updatedConfigurations += 1;

      const configurationName = String(entry.name ?? '').replaceAll('"', '');
      if (configurationName === 'Release') {
        entry.buildSettings.ENABLE_DEBUG_DYLIB = 'NO';
        entry.buildSettings.SWIFT_OPTIMIZATION_LEVEL = '"-O"';
        updatedReleaseConfigurations += 1;
      }
    }

    if (updatedConfigurations !== 2 || updatedReleaseConfigurations !== 1) {
      throw new Error(
        `Expected two ${WIDGET_BUNDLE_IDENTIFIER} configurations and one Release configuration; updated ${updatedConfigurations}/${updatedReleaseConfigurations}.`,
      );
    }

    return projectConfig;
  });
};
