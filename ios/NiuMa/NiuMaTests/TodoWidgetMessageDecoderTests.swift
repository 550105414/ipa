import XCTest
@testable import NiuMa

final class TodoWidgetMessageDecoderTests: XCTestCase {
    func testDecodesOpenTaskSnapshotFromWebBridge() throws {
        let snapshot = try XCTUnwrap(
            TodoWidgetMessageDecoder.decode([
                "version": 1,
                "generatedAt": "2026-08-10T08:00:00.000Z",
                "items": [
                    [
                        "id": "task-1",
                        "title": " 回访客户 ",
                        "dueAt": "2026-08-10T09:30:00.000Z",
                    ],
                ],
            ])
        )

        XCTAssertEqual(snapshot.version, 1)
        XCTAssertEqual(snapshot.items.count, 1)
        XCTAssertEqual(snapshot.items.first?.id, "task-1")
        XCTAssertEqual(snapshot.items.first?.title, "回访客户")
        XCTAssertNotNil(snapshot.items.first?.dueAt)
    }

    func testRejectsUnsupportedPayloadVersion() {
        XCTAssertNil(TodoWidgetMessageDecoder.decode(["version": 2, "items": []]))
    }
}
