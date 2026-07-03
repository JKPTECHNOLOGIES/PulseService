const {
  buildCustomerAddRequest,
  buildCustomerModRequest,
  parseQbxmlResponse,
  isSuccess,
  extractIdentity,
  resolveCustomerName,
} = require("./qbxml.service");

describe("qbxml.service", () => {
  describe("resolveCustomerName", () => {
    it("prefers the company name when present", () => {
      expect(
        resolveCustomerName({ companyName: "Acme Corp", firstName: "John", lastName: "Doe" }),
      ).toBe("Acme Corp");
    });

    it("falls back to first + last name", () => {
      expect(resolveCustomerName({ firstName: "John", lastName: "Doe" })).toBe("John Doe");
    });

    it("truncates to QuickBooks' 41-character Name limit", () => {
      const name = resolveCustomerName({
        companyName: "A Company Name So Long It Blows Past Forty-One Characters",
      });
      expect(name.length).toBeLessThanOrEqual(41);
    });
  });

  describe("buildCustomerAddRequest", () => {
    it("builds a well-formed CustomerAddRq with the expected fields", () => {
      const xml = buildCustomerAddRequest({
        requestId: "job-1",
        customer: {
          firstName: "Jane",
          lastName: "Smith",
          companyName: "",
          phone: "555-0100",
          email: "jane@example.com",
          billAddress: { address: "123 Main St", city: "Atlanta", state: "GA", zip: "30301" },
        },
      });

      expect(xml).toContain('<?qbxml version="13.0"?>');
      expect(xml).toContain('<CustomerAddRq requestID="job-1">');
      expect(xml).toContain("<Name>Jane Smith</Name>");
      expect(xml).toContain("<Phone>555-0100</Phone>");
      expect(xml).toContain("<Addr1>123 Main St</Addr1>");
      expect(xml).not.toContain("<CompanyName></CompanyName>"); // omitted when blank
    });

    it("omits BillAddress entirely when no address is given", () => {
      const xml = buildCustomerAddRequest({
        requestId: "job-2",
        customer: { firstName: "No", lastName: "Address" },
      });
      expect(xml).not.toContain("<BillAddress>");
    });
  });

  describe("buildCustomerModRequest", () => {
    it("includes ListID and EditSequence for the update", () => {
      const xml = buildCustomerModRequest({
        requestId: "job-3",
        customer: { firstName: "Jane", lastName: "Smith" },
        quickbooksId: "80000001-1234567890",
        editSequence: "1234567890",
      });
      expect(xml).toContain('<CustomerModRq requestID="job-3">');
      expect(xml).toContain("<ListID>80000001-1234567890</ListID>");
      expect(xml).toContain("<EditSequence>1234567890</EditSequence>");
    });
  });

  describe("parseQbxmlResponse / isSuccess / extractIdentity", () => {
    it("parses a successful CustomerAddRs and extracts identity", () => {
      const xml = `<?xml version="1.0"?>
        <QBXML>
          <QBXMLMsgsRs>
            <CustomerAddRs requestID="job-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">
              <CustomerRet>
                <ListID>80000001-1234567890</ListID>
                <EditSequence>1234567890</EditSequence>
                <Name>Jane Smith</Name>
              </CustomerRet>
            </CustomerAddRs>
          </QBXMLMsgsRs>
        </QBXML>`;

      const parsed = parseQbxmlResponse(xml);
      expect(parsed.rsType).toBe("CustomerAddRs");
      expect(parsed.requestId).toBe("job-1");
      expect(isSuccess(parsed)).toBe(true);

      const identity = extractIdentity(parsed.ret);
      expect(identity.listId).toBe("80000001-1234567890");
      expect(identity.editSequence).toBe("1234567890");
    });

    it("parses an error response with no Ret element", () => {
      const xml = `<?xml version="1.0"?>
        <QBXML>
          <QBXMLMsgsRs>
            <CustomerAddRs requestID="job-1" statusCode="3100" statusSeverity="Error" statusMessage="The name of the list element is already in use.">
            </CustomerAddRs>
          </QBXMLMsgsRs>
        </QBXML>`;

      const parsed = parseQbxmlResponse(xml);
      expect(isSuccess(parsed)).toBe(false);
      expect(parsed.statusMessage).toContain("already in use");
      expect(extractIdentity(parsed.ret)).toBeNull();
    });
  });
});
