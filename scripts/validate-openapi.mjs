import SwaggerParser from "@apidevtools/swagger-parser";

try {
  await SwaggerParser.validate("openapi.yaml");
  console.log("openapi.yaml is valid");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
