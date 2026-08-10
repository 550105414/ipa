import XCTest
@testable import NiuMa

final class WorkspaceAddressErrorTests: XCTestCase {
    func testInvalidAddressHasActionableDescription() {
        XCTAssertEqual(WorkspaceAddressError.invalidAddress.errorDescription, "工作台地址无效。")
    }
}
