import 'package:flutter_test/flutter_test.dart';
import 'package:barcode_scale/main.dart';

void main() {
  testWidgets('App renders', (WidgetTester tester) async {
    await tester.pumpWidget(const OmniScaleApp());
    expect(find.text('Not Connected'), findsOneWidget);
  });
}
