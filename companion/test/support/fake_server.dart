import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Records every request and answers with [respond].
class FakeServer {
  FakeServer(this.respond);

  http.Response Function(http.Request request) respond;
  final requests = <http.Request>[];

  late final http.Client client = MockClient((request) async {
    requests.add(request);
    return respond(request);
  });

  http.Request get last => requests.last;

  Object? get lastJson => jsonDecode(last.body);
}

http.Response jsonResponse(int status, Object? body, {Map<String, String> headers = const {}}) =>
    http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json; charset=utf-8', ...headers},
    );

http.Response errorResponse(int status, String code, {Map<String, String> headers = const {}}) =>
    jsonResponse(status, {
      'error': {'code': code, 'message': 'msg for $code'},
    }, headers: headers);

/// 43 base64url characters, the shape of a real device token.
const sampleToken = 'tok_SECRET_abcdefghijklmnopqrstuvwxyz012345';
const sampleDeviceId = '6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4';

Map<String, Object?> pairBody({String token = sampleToken}) => {
  'deviceId': sampleDeviceId,
  'deviceToken': token,
  'heartbeatIntervalSec': 600,
};
