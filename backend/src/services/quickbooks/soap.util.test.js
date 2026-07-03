const { parseSoapRequest, buildSoapResponse, buildSoapFault } = require("./soap.util");

function envelope(methodXml) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n` +
    `  <soap:Body>${methodXml}</soap:Body>\n` +
    `</soap:Envelope>`
  );
}

describe("soap.util", () => {
  describe("parseSoapRequest", () => {
    it("parses authenticate() with its two string params", () => {
      const xml = envelope(
        `<authenticate xmlns="http://developer.intuit.com/">` +
          `<strUserName>pulseservice</strUserName>` +
          `<strPassword>secret</strPassword>` +
          `</authenticate>`,
      );
      const { method, params } = parseSoapRequest(xml);
      expect(method).toBe("authenticate");
      expect(params.strUserName).toBe("pulseservice");
      expect(params.strPassword).toBe("secret");
    });

    it("parses sendRequestXML() with all six params, tolerating an empty one", () => {
      const xml = envelope(
        `<sendRequestXML xmlns="http://developer.intuit.com/">` +
          `<ticket>abc-123</ticket>` +
          `<strHCPResponse></strHCPResponse>` +
          `<strCompanyFileName></strCompanyFileName>` +
          `<qbXMLCountry>US</qbXMLCountry>` +
          `<qbXMLMajorVers>13</qbXMLMajorVers>` +
          `<qbXMLMinorVers>0</qbXMLMinorVers>` +
          `</sendRequestXML>`,
      );
      const { method, params } = parseSoapRequest(xml);
      expect(method).toBe("sendRequestXML");
      expect(params.ticket).toBe("abc-123");
      expect(params.strHCPResponse).toBe("");
      expect(params.qbXMLMajorVers).toBe("13");
    });

    it("throws on a body with no method element", () => {
      const xml = envelope("");
      expect(() => parseSoapRequest(xml)).toThrow();
    });
  });

  describe("buildSoapResponse", () => {
    it("wraps an array result (authenticate) as repeated <string> elements", () => {
      const xml = buildSoapResponse("authenticate", ["ticket-1", ""]);
      expect(xml).toContain("<authenticateResult>");
      expect(xml).toContain("<string>ticket-1</string>");
      expect(xml).toContain("<string></string>");
    });

    it("wraps a scalar string result without a <string> wrapper", () => {
      const xml = buildSoapResponse("closeConnection", "PulseService sync complete.");
      expect(xml).toContain(
        "<closeConnectionResult>PulseService sync complete.</closeConnectionResult>",
      );
    });

    it("escapes XML-significant characters in string results", () => {
      const xml = buildSoapResponse("getLastError", 'Bad & <weird> "quote"');
      expect(xml).toContain("Bad &amp; &lt;weird&gt; &quot;quote&quot;");
    });

    it("renders a numeric result (receiveResponseXML) without quoting", () => {
      const xml = buildSoapResponse("receiveResponseXML", 100);
      expect(xml).toContain("<receiveResponseXMLResult>100</receiveResponseXMLResult>");
    });
  });

  describe("buildSoapFault", () => {
    it("produces a SOAP Fault envelope with the given message", () => {
      const xml = buildSoapFault("boom");
      expect(xml).toContain("<soap:Fault>");
      expect(xml).toContain("<faultstring>boom</faultstring>");
    });
  });
});
