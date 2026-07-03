const {
  buildCustomerAddRequest,
  buildCustomerModRequest,
  buildInvoiceAddRequest,
  buildInvoiceModRequest,
  buildTxnVoidRequest,
  buildReceivePaymentAddRequest,
  parseQbxmlResponse,
  isSuccess,
  extractIdentity,
  resolveCustomerName,
} = require("./qbxml.service");

describe("qbxml.service", () => {
  describe("resolveCustomerName", () => {
    it("prefers the company name when present", () => {
      expect(
        resolveCustomerName({
          companyName: "Acme Corp",
          firstName: "John",
          lastName: "Doe",
        }),
      ).toBe("Acme Corp");
    });

    it("falls back to first + last name", () => {
      expect(resolveCustomerName({ firstName: "John", lastName: "Doe" })).toBe(
        "John Doe",
      );
    });

    it("truncates to QuickBooks' 41-character Name limit", () => {
      const name = resolveCustomerName({
        companyName:
          "A Company Name So Long It Blows Past Forty-One Characters",
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
          billAddress: {
            address: "123 Main St",
            city: "Atlanta",
            state: "GA",
            zip: "30301",
          },
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

    it("parses a successful InvoiceAddRs and extracts the TxnID", () => {
      const xml = `<?xml version="1.0"?>
        <QBXML>
          <QBXMLMsgsRs>
            <InvoiceAddRs requestID="inv-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">
              <InvoiceRet>
                <TxnID>9000001-1234567890</TxnID>
                <EditSequence>1111111111</EditSequence>
              </InvoiceRet>
            </InvoiceAddRs>
          </QBXMLMsgsRs>
        </QBXML>`;
      const parsed = parseQbxmlResponse(xml);
      expect(isSuccess(parsed)).toBe(true);
      expect(extractIdentity(parsed.ret).txnId).toBe("9000001-1234567890");
    });

    it("parses a successful TxnVoidRs with no Ret element", () => {
      const xml = `<?xml version="1.0"?>
        <QBXML>
          <QBXMLMsgsRs>
            <TxnVoidRs requestID="void-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK"></TxnVoidRs>
          </QBXMLMsgsRs>
        </QBXML>`;
      const parsed = parseQbxmlResponse(xml);
      expect(isSuccess(parsed)).toBe(true);
      expect(extractIdentity(parsed.ret)).toBeNull();
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

  describe("buildInvoiceAddRequest", () => {
    it("builds an InvoiceAddRq with lines, a tax line, and a discount line", () => {
      const xml = buildInvoiceAddRequest({
        requestId: "inv-job-1",
        invoice: {
          invoiceNumber: "INV-1001",
          createdAt: "2024-03-01T00:00:00.000Z",
          dueDate: "2024-03-31T00:00:00.000Z",
          notes: "Thanks for your business",
        },
        customerQbId: "80000001-111",
        lines: [
          {
            itemName: "Labor",
            description: "HVAC repair",
            quantity: 2,
            rate: 50,
            amount: 100,
          },
          { itemName: "PLACEHOLDER - Sales Tax", amount: 8.25 },
          { itemName: "Discount Item", amount: -10 },
        ],
      });

      expect(xml).toContain('<InvoiceAddRq requestID="inv-job-1">');
      expect(xml).toContain(
        "<CustomerRef><ListID>80000001-111</ListID></CustomerRef>",
      );
      expect(xml).toContain("<RefNumber>INV-1001</RefNumber>");
      expect(xml).toContain("<TxnDate>2024-03-01</TxnDate>");
      expect(xml).toContain("<DueDate>2024-03-31</DueDate>");
      expect(xml).toContain("<FullName>Labor</FullName>");
      expect(xml).toContain("<Quantity>2</Quantity>");
      expect(xml).toContain("<Rate>50.00</Rate>");
      expect(xml).toContain("<Amount>100.00</Amount>");
      expect(xml).toContain("<FullName>PLACEHOLDER - Sales Tax</FullName>");
      expect(xml).toContain("<Amount>8.25</Amount>");
      expect(xml).toContain("<Amount>-10.00</Amount>");
    });
  });

  describe("buildInvoiceModRequest", () => {
    it("is header-only: no InvoiceLineMod elements", () => {
      const xml = buildInvoiceModRequest({
        requestId: "inv-job-2",
        invoice: {
          invoiceNumber: "INV-1001",
          createdAt: "2024-03-01T00:00:00.000Z",
        },
        quickbooksId: "9000001-111",
        editSequence: "222",
      });
      expect(xml).toContain('<InvoiceModRq requestID="inv-job-2">');
      expect(xml).toContain("<TxnID>9000001-111</TxnID>");
      expect(xml).toContain("<EditSequence>222</EditSequence>");
      expect(xml).not.toContain("InvoiceLineMod");
    });
  });

  describe("buildTxnVoidRequest", () => {
    it("builds a generic TxnVoidRq for an Invoice", () => {
      const xml = buildTxnVoidRequest({
        requestId: "void-job",
        quickbooksId: "9000001-111",
      });
      expect(xml).toContain('<TxnVoidRq requestID="void-job">');
      expect(xml).toContain("<TxnID>9000001-111</TxnID>");
      expect(xml).toContain("<TxnDelType>Invoice</TxnDelType>");
    });
  });

  describe("buildReceivePaymentAddRequest", () => {
    it("applies the payment to the given invoice TxnID", () => {
      const xml = buildReceivePaymentAddRequest({
        requestId: "pay-job-1",
        customerQbId: "80000001-111",
        payment: {
          amount: 108.25,
          paidAt: "2024-03-05T00:00:00.000Z",
          referenceNumber: "ACH-9001",
        },
        invoiceTxnId: "9000001-111",
      });
      expect(xml).toContain('<ReceivePaymentAddRq requestID="pay-job-1">');
      expect(xml).toContain(
        "<CustomerRef><ListID>80000001-111</ListID></CustomerRef>",
      );
      expect(xml).toContain("<TotalAmount>108.25</TotalAmount>");
      expect(xml).toContain("<RefNumber>ACH-9001</RefNumber>");
      expect(xml).toContain("<TxnID>9000001-111</TxnID>");
      expect(xml).toContain("<PaymentAmount>108.25</PaymentAmount>");
      expect(xml).not.toContain("DepositToAccountRef"); // omitted when not configured
    });

    it("includes DepositToAccountRef when configured", () => {
      const xml = buildReceivePaymentAddRequest({
        requestId: "pay-job-2",
        customerQbId: "80000001-111",
        payment: { amount: 50, createdAt: "2024-03-05T00:00:00.000Z" },
        invoiceTxnId: "9000001-111",
        depositToAccountName: "Undeposited Funds",
      });
      expect(xml).toContain(
        "<DepositToAccountRef><FullName>Undeposited Funds</FullName></DepositToAccountRef>",
      );
    });
  });
});
