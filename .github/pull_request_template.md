## Summary

<!-- What changes and why. Link the issue: Closes #n -->

## Verification

<!-- Tick what was actually run. Anything unticked is not verified. -->

- [ ] `npm run check:release` passes locally
- [ ] New or updated regression test for this change
- [ ] Fixture replay (`npm run debug:bank`) — banks/fixtures:
- [ ] Real bank readback on localhost — banks, fields, date observed:
- [ ] Real Chrome install of the CI artifact (release acceptance only)

Not run / still unknown:

## Checklist

- [ ] UI strings added in zh-CN, zh-TW and en
- [ ] No real amounts, card numbers, screenshots, wallet data, keys or personal paths in the diff, description or test fixtures
- [ ] Bank access remains read-only
